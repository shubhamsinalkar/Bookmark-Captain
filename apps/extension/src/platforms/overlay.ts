/**
 * A small status box shown on a platform page during a visible sync or while learning a
 * site. It lives in a shadow root so the site's CSS can't restyle it. All text goes in
 * through textContent; nothing is parsed as HTML except the static shell.
 */

const STYLES = `
  :host { all: initial; }
  .box {
    position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
    width: 320px; max-height: 70vh; overflow: auto; box-sizing: border-box; padding: 14px 16px;
    border-radius: 12px; background: #0f2a3d; color: #eef2f3;
    font: 14px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif;
    box-shadow: 0 12px 32px -12px rgb(0 0 0 / 0.5);
  }
  .head { display: flex; align-items: center; gap: 8px; font-weight: 700; }
  .mark { width: 10px; height: 14px; background: #d0202e;
    clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 72%, 0 100%); }
  p { margin: 6px 0 0; color: #b9c7d0; }
  ul { margin: 10px 0 0; padding: 0; list-style: none; }
  li { padding: 6px 8px; margin-top: 4px; border-radius: 6px; background: rgb(255 255 255 / 0.07);
    color: #eef2f3; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
  button { font: inherit; font-weight: 600; padding: 6px 12px; border-radius: 6px;
    border: 1px solid #52677a; background: transparent; color: #eef2f3; cursor: pointer; }
  button.primary { background: #eef2f3; color: #0f2a3d; border-color: #eef2f3; }
  button:hover { border-color: #eef2f3; }
  button:focus-visible { outline: 2px solid #7ea6ff; outline-offset: 2px; }
`;

export interface OverlayAction {
  label: string;
  primary?: boolean;
  onClick: () => void;
}

export interface OverlayView {
  message: string;
  items?: string[];
  actions?: OverlayAction[];
}

export interface Overlay {
  show(view: OverlayView): void;
  /** Changes the message, keeping the buttons. */
  update(message: string): void;
  /** Shows a final message and a single action button. */
  finish(message: string, action: OverlayAction): void;
  setAction(action: OverlayAction | null): void;
  remove(): void;
}

export function createOverlay(title: string): Overlay {
  const host = document.createElement('bookmark-captain-status');
  // Open, so automated tests can reach the buttons; it holds nothing the page can't see.
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${STYLES}</style>
    <div class="box" role="status" aria-live="polite">
      <div class="head"><span class="mark"></span><span class="title"></span></div>
      <p class="message"></p>
      <ul hidden></ul>
      <div class="actions"></div>
    </div>`;
  root.querySelector('.title')!.textContent = title;
  const messageNode = root.querySelector('.message')!;
  const list = root.querySelector('ul')!;
  const actions = root.querySelector('.actions')!;
  (document.body ?? document.documentElement).append(host);

  const setActions = (items: OverlayAction[]) => {
    actions.replaceChildren(
      ...items.map((action) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = action.label;
        if (action.primary) button.className = 'primary';
        button.addEventListener('click', action.onClick);
        return button;
      }),
    );
  };

  const show = (view: OverlayView) => {
    messageNode.textContent = view.message;
    list.hidden = !view.items?.length;
    list.replaceChildren(
      ...(view.items ?? []).map((text) => {
        const item = document.createElement('li');
        item.textContent = text;
        return item;
      }),
    );
    setActions(view.actions ?? []);
  };

  return {
    show,
    update: (message) => {
      messageNode.textContent = message;
    },
    finish: (message, action) => show({ message, actions: [action] }),
    setAction: (action) => setActions(action ? [action] : []),
    remove: () => host.remove(),
  };
}
