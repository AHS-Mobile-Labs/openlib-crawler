async function mapLimit(items, limit, worker) {
  const results = [];
  const executing = new Set();
  let index = 0;

  async function run(item, itemIndex) {
    const result = await worker(item, itemIndex);
    results[itemIndex] = result;
  }

  while (index < items.length) {
    const currentIndex = index++;
    const promise = run(items[currentIndex], currentIndex).finally(() => executing.delete(promise));
    executing.add(promise);

    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
  return results;
}

module.exports = {
  mapLimit
};
