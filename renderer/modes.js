'use strict';
// Кнопка «Ещё» у плеера: режимы, которым не место на панели — караоке, визуализатор, таймер сна,
// будильник, фокус, итоги года. У караоке и визуализатора — ещё и клавиши K и V.

$('#btn-modes').addEventListener('click', (e) => {
  e.stopPropagation();
  const a = alarmCfg();
  showMenu([
    { label: karaoke.on ? 'Выключить караоке' : 'Караоке', icon: 'i-mic', count: 'K', onClick: () => toggleKaraoke() },
    { label: 'Визуализатор', icon: 'i-viz', count: 'V', onClick: openVisualizer },
    { label: pomo.on ? 'Фокус идёт' : 'Режим фокуса', icon: 'i-focus', count: pomo.on ? fmmss(focusLeft()) : null, onClick: openFocus },
    { sep: true },
    ...sleepMenuItems(),
    { sep: true },
    { label: 'Будильник', icon: 'i-alarm', count: a.on ? a.time : null, onClick: openAlarm },
    { label: `Итоги ${wrappedYear()}`, icon: 'i-stats', onClick: openWrapped },
  ], { anchor: e.currentTarget });
});
