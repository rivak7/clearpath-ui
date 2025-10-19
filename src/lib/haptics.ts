const supportsVibration = () => typeof navigator !== 'undefined' && 'vibrate' in navigator;

export function vibrateNear() {
  if (supportsVibration()) {
    navigator.vibrate?.([15]);
  }
}

export function vibrateArrive() {
  if (supportsVibration()) {
    navigator.vibrate?.([30, 20, 30]);
  }
}

export function vibrateSave() {
  if (supportsVibration()) {
    navigator.vibrate?.([60]);
  }
}
