/**
 * Ctrl/Cmd+Enter men-submit form terdekat. Enter biasa tetap diteruskan
 * ke textarea sebagai newline.
 */
export function submitOnCtrlEnter(event: KeyboardEvent): boolean {
  if (!(event.ctrlKey || event.metaKey) || event.key !== 'Enter') return false;
  const target = event.target;
  if (!(target instanceof Element)) return false;
  const form = target.closest('form');
  if (!(form instanceof HTMLFormElement)) return false;
  event.preventDefault();
  if (typeof form.requestSubmit === 'function') form.requestSubmit();
  else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  return true;
}
