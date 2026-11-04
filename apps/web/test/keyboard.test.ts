import { describe, expect, it, vi } from 'vitest';
import { submitOnCtrlEnter } from '../src/lib/keyboard';

function makeForm(): { form: HTMLFormElement; input: HTMLInputElement; onSubmit: ReturnType<typeof vi.fn> } {
  const form = document.createElement('form');
  const input = document.createElement('input');
  form.appendChild(input);
  document.body.appendChild(form);
  const onSubmit = vi.fn((event: Event) => event.preventDefault());
  form.addEventListener('submit', onSubmit);
  input.addEventListener('keydown', submitOnCtrlEnter);
  return { form, input, onSubmit };
}

describe('submitOnCtrlEnter', () => {
  it('men-submit form saat Ctrl+Enter', () => {
    const { input, onSubmit } = makeForm();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('tidak men-submit saat Enter biasa', () => {
    const { input, onSubmit } = makeForm();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('tidak men-submit jika target bukan di dalam form', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    const event = new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true });
    input.addEventListener('keydown', (item) => submitOnCtrlEnter(item));
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
