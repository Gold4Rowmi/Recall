// Controller: standard mapping, read only while a pad is connected and the window is in use.
const BUTTONS = { 0:'a', 1:'b', 2:'x', 3:'y', 4:'l', 5:'r', 9:'start' };
const DPAD = { up:12, down:13, left:14, right:15 };
const DEAD = .5, DELAY = 350, EVERY = 120;

// held remembers presses between polls: one action per press, and directions repeat while held.
export function padActions(pad, held, now){
  const out = [], on = i => !!pad.buttons[i]?.pressed, [x = 0, y = 0] = pad.axes;
  for (const [i, act] of Object.entries(BUTTONS)){ const down = on(i); if (down && !held[act]) out.push(act); held[act] = down; }
  const dirs = { up:on(DPAD.up) || y < -DEAD, down:on(DPAD.down) || y > DEAD, left:on(DPAD.left) || x < -DEAD, right:on(DPAD.right) || x > DEAD };
  for (const [dir, down] of Object.entries(dirs)){
    if (!down){ held[dir] = 0; continue; }
    if (!held[dir]){ out.push(dir); held[dir] = now + DELAY; }
    else if (now >= held[dir]){ out.push(dir); held[dir] = now + EVERY; }
  }
  return out;
}

export function startPad(run){
  let frame = 0, held = {};
  const pad = () => [...navigator.getGamepads()].find(p => p?.mapping === 'standard');
  const poll = now => {
    frame = 0;
    const p = pad(); if (!p || document.hidden) return; // a reconnect or returning to the window restarts this
    if (document.hasFocus()) padActions(p, held, now).forEach(run); else held = {};
    frame = requestAnimationFrame(poll);
  };
  const start = () => { if (!frame && pad() && !document.hidden) frame = requestAnimationFrame(poll); };
  addEventListener('gamepadconnected', start);
  document.addEventListener('visibilitychange', start);
}
