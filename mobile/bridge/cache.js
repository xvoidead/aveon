// Файлы кэша треков на Android: качает и хранит AveonPlugin (files/cache-audio),
// играет WebView по адресу /_media/cache (AveonWebViewClient). Логика кэша — src/cache.js
const { Aveon } = require('./native.js');

module.exports = {
  download: async (urls, name) => (await Aveon.cacheDownload({ urls, name })).size,
  remove: (name) => Aveon.cacheRemove({ name }),
  clear: () => Aveon.cacheClear(),
  list: async () => (await Aveon.cacheList()).files || [],
  url: (name) => `${location.origin}/_media/cache?f=${name}`,
};
