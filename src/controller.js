export const Buttons = Object.freeze({
  A: 0,
  B: 1,
  SELECT: 2,
  START: 3,
  UP: 4,
  DOWN: 5,
  LEFT: 6,
  RIGHT: 7,
});

export class Controller {
  constructor() {
    this.state = 0;
    this.shift = 0;
    this.strobe = false;
  }

  setButton(button, pressed) {
    const mask = 1 << button;
    if (pressed) {
      this.state |= mask;
    } else {
      this.state &= ~mask;
    }
    if (this.strobe) this.shift = this.state;
  }

  write(value) {
    const nextStrobe = (value & 1) !== 0;
    if (nextStrobe || this.strobe) this.shift = this.state;
    this.strobe = nextStrobe;
  }

  read() {
    const value = (this.shift & 1) | 0x40;
    if (!this.strobe) this.shift = (this.shift >>> 1) | 0x80;
    return value;
  }
}
