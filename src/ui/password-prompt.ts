/** A password is kept only by the active preview and is discarded on close. */
export function requestPassword(target: HTMLElement, name: string, signal: AbortSignal, error = ''): Promise<string | null> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(null); return; }
    const wrapper = document.createElement('div'); wrapper.className = 'password-prompt';
    const form = document.createElement('form'); form.className = 'password-card';
    const title = document.createElement('strong'); title.textContent = '输入打开密码';
    const detail = document.createElement('p'); detail.textContent = name;
    const input = document.createElement('input'); input.type = 'password'; input.placeholder = '密码'; input.autocomplete = 'off'; input.maxLength = 255;
    input.setAttribute('aria-label', '打开密码');
    const hint = document.createElement('p'); hint.className = 'password-error'; hint.textContent = error; hint.setAttribute('aria-live', 'polite');
    const actions = document.createElement('div'); actions.className = 'password-actions';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = '取消';
    const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = '打开';
    actions.append(cancel, submit); form.append(title, detail, input, hint, actions); wrapper.append(form); target.replaceChildren(wrapper);
    let done = false;
    const finish = (password: string | null): void => {
      if (done) return;
      done = true; signal.removeEventListener('abort', abort); input.value = ''; resolve(password);
    };
    const abort = (): void => finish(null);
    signal.addEventListener('abort', abort, { once: true });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!input.value) { hint.textContent = '请输入密码。'; input.focus(); return; }
      finish(input.value);
    });
    cancel.addEventListener('click', () => finish(null));
    target.ownerDocument.defaultView?.slowLook?.focusPreview?.();
    input.focus();
  });
}
