'use strict';
// Кнопка «Ещё» у плеера: режимы, которым не место на панели — караоке, визуализатор, таймер сна,
// будильник, фокус, итоги года. У караоке и визуализатора — ещё и клавиши K и V.

// Пункты режимов — ещё и в меню «ещё» у названия трека (app.js → btn-now-more, дизайн «Стекло»)
function modesMenuItems() {
  const a = alarmCfg();
  return [
    { label: karaoke.on ? 'Выключить караоке' : 'Караоке', icon: 'i-mic', count: 'K', onClick: () => toggleKaraoke() },
    { label: 'Визуализатор', icon: 'i-viz', count: 'V', onClick: openVisualizer },
    { label: pomo.on ? 'Фокус идёт' : 'Режим фокуса', icon: 'i-focus', count: pomo.on ? fmmss(focusLeft()) : null, onClick: openFocus },
    { sep: true },
    ...sleepMenuItems(),
    { sep: true },
    { label: 'Будильник', icon: 'i-alarm', count: a.on ? a.time : null, onClick: openAlarm },
    { label: `Итоги ${wrappedYear()}`, icon: 'i-stats', onClick: openWrapped },
  ];
}

$('#btn-modes').addEventListener('click', (e) => {
  e.stopPropagation();
  showMenu(modesMenuItems(), { anchor: e.currentTarget });
});
