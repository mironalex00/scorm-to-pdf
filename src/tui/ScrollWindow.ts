/** Keeps the focused row visible as the cursor moves. */
export class ScrollWindow {
  private offset = 0;

  window(cursor: number, total: number, height: number): { start: number; end: number } {
    if (cursor < this.offset) this.offset = cursor;
    if (cursor >= this.offset + height) this.offset = cursor - height + 1;
    this.offset = Math.min(this.offset, Math.max(0, total - height));
    return { start: this.offset, end: Math.min(total, this.offset + height) };
  }
}
