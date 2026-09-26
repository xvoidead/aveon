// Имя устройства для списка устройств аккаунта: модель телефона (задаёт bridge/index.js)
let name = 'Android';
export function setHostname(n) { if (n) name = String(n); }
export function hostname() { return name; }
export default { hostname, setHostname };
