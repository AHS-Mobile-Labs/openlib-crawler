use crate::config::ControlConfig;
use crate::models::{DiskStats, NetworkStats, SystemStats};
use std::fs;
use std::sync::Arc;
use sysinfo::{Disks, System};

#[derive(Clone)]
pub struct SystemService {
    config: Arc<ControlConfig>,
}

impl SystemService {
    pub fn new(config: Arc<ControlConfig>) -> Self {
        Self { config }
    }

    pub async fn snapshot(&self) -> SystemStats {
        let config = self.config.clone();
        tokio::task::spawn_blocking(move || {
            let mut sys = System::new_all();
            sys.refresh_all();
            let disks = Disks::new_with_refreshed_list()
                .list()
                .iter()
                .map(|disk| DiskStats {
                    mount: disk.mount_point().display().to_string(),
                    total_bytes: disk.total_space(),
                    available_bytes: disk.available_space(),
                })
                .collect::<Vec<_>>();
            let load = System::load_average();

            SystemStats {
                cpu_percent: sys.global_cpu_usage(),
                memory_used_bytes: sys.used_memory(),
                memory_total_bytes: sys.total_memory(),
                swap_used_bytes: sys.used_swap(),
                swap_total_bytes: sys.total_swap(),
                load_one: load.one,
                load_five: load.five,
                load_fifteen: load.fifteen,
                disks,
                network: read_linux_network(),
                db_size_bytes: fs::metadata(&config.db_path).map(|metadata| metadata.len()).unwrap_or(0),
            }
        })
        .await
        .unwrap_or_default()
    }
}

fn read_linux_network() -> NetworkStats {
    let content = fs::read_to_string("/proc/net/dev").unwrap_or_default();
    let mut stats = NetworkStats::default();
    for line in content.lines().skip(2) {
        let Some((_, values)) = line.split_once(':') else {
            continue;
        };
        let columns = values.split_whitespace().collect::<Vec<_>>();
        if columns.len() < 16 {
            continue;
        }
        stats.rx_bytes += columns[0].parse::<u64>().unwrap_or(0);
        stats.tx_bytes += columns[8].parse::<u64>().unwrap_or(0);
    }
    stats
}
