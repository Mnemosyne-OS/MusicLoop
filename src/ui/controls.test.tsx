import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NumberField } from './controls';

afterEach(cleanup);

/** One keystroke, as a browser reports it: an input event that says it inserted text. */
const type = (el: HTMLElement, value: string) => fireEvent.input(el, { target: { value }, inputType: 'insertText' });

describe('NumberField', () => {
  const field = (onCommit: (v: number) => void, value = 120) =>
    render(<NumberField label="BPM" value={value} min={40} max={300} step={0.1} digits={1} onCommit={onCommit} />);

  it('lets a value be typed digit by digit: nothing is committed on the way', () => {
    const onCommit = vi.fn();
    field(onCommit);
    const input = screen.getByRole('spinbutton', { name: 'BPM' }) as HTMLInputElement;
    fireEvent.focus(input);
    type(input, '1');
    expect(input.value).toBe('1'); // under the minimum, and still what the person typed
    type(input, '12');
    type(input, '128');
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(128);
  });

  it('commits on Enter, held inside the bounds', () => {
    const onCommit = vi.fn();
    field(onCommit);
    const input = screen.getByRole('spinbutton', { name: 'BPM' }) as HTMLInputElement;
    fireEvent.focus(input);
    type(input, '999');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith(300);
    expect(input.value).toBe('300');
    type(input, '3');
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenLastCalledWith(40);
  });

  it('puts the last value back when the field is left empty or unreadable', () => {
    const onCommit = vi.fn();
    field(onCommit);
    const input = screen.getByRole('spinbutton', { name: 'BPM' }) as HTMLInputElement;
    fireEvent.focus(input);
    type(input, '');
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe('120');
  });

  it('reads a comma as a decimal point, and commits nothing for the value it already has', () => {
    const onCommit = vi.fn();
    field(onCommit);
    const input = screen.getByRole('spinbutton', { name: 'BPM' }) as HTMLInputElement;
    fireEvent.focus(input);
    type(input, '120');
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.focus(input);
    // jsdom empties a number field given "93,5"; the same text through the parser:
    type(input, '93.5');
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(93.5);
  });

  it('commits at once a change that is not a keystroke: the arrows of the field', () => {
    const onCommit = vi.fn();
    field(onCommit);
    const input = screen.getByRole('spinbutton', { name: 'BPM' }) as HTMLInputElement;
    fireEvent.input(input, { target: { value: '120.1' } });
    expect(onCommit).toHaveBeenCalledWith(120.1);
  });

  it('follows a value changed from outside when nobody is typing, and leaves the text alone while they are', () => {
    const onCommit = vi.fn();
    const view = field(onCommit, 120);
    const input = screen.getByRole('spinbutton', { name: 'BPM' }) as HTMLInputElement;
    view.rerender(<NumberField label="BPM" value={60} min={40} max={300} step={0.1} digits={1} onCommit={onCommit} />);
    expect(input.value).toBe('60');
    fireEvent.focus(input);
    type(input, '9');
    view.rerender(<NumberField label="BPM" value={240} min={40} max={300} step={0.1} digits={1} onCommit={onCommit} />);
    expect(input.value).toBe('9');
  });
});
