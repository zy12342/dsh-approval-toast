/**
 * desktop-notify — Web Client helper.
 *
 * Reports the currently active conversation (and whether the DSH window is
 * focused) to the host. The host uses this id — not the window title — to
 * suppress notifications for the conversation the user is already looking at,
 * while still notifying for other conversations.
 */
window.__ModuleLoader__.load({
  id: 'dsh-approval-toast',
  factory(require) {
    const React = require('react');
    let currentSessionId = '';
    let clearTimer = null;

    function post() {
      const body = {
        sessionId: currentSessionId || null,
        focused: document.visibilityState === 'visible' && document.hasFocus(),
      };
      try {
        fetch('/desktop-notify/api/active', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }).catch(() => {});
      } catch (_) {
        /* host route is best-effort */
      }
    }

    function scheduleClear() {
      if (clearTimer) clearTimeout(clearTimer);
      clearTimer = setTimeout(() => {
        clearTimer = null;
        currentSessionId = '';
        post();
      }, 300);
    }

    function ActiveSessionReporter(props) {
      const sessionId = props && props.scope && props.scope.sessionId;
      React.useEffect(() => {
        if (!sessionId) return () => {};
        if (clearTimer) {
          clearTimeout(clearTimer);
          clearTimer = null;
        }
        currentSessionId = sessionId;
        post();
        const onWindow = () => post();
        window.addEventListener('focus', onWindow);
        window.addEventListener('blur', onWindow);
        document.addEventListener('visibilitychange', onWindow);
        const timer = setInterval(post, 60000);
        return () => {
          window.removeEventListener('focus', onWindow);
          window.removeEventListener('blur', onWindow);
          document.removeEventListener('visibilitychange', onWindow);
          clearInterval(timer);
          scheduleClear();
        };
      }, [sessionId]);
      return null;
    }

    function connectOpenEvents(ctx) {
      if (typeof EventSource !== 'function') return () => {};
      let source;
      try {
        source = new EventSource('/desktop-notify/api/events');
      } catch (_) {
        return () => {};
      }
      source.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data || '{}');
          if (!data || data.type !== 'open-session' || typeof data.sessionId !== 'string') return;
          const workspace = (typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : undefined) || ctx.uiWorkspace;
          if (workspace && typeof workspace.openSession === 'function') workspace.openSession(data.sessionId);
          try {
            window.focus();
          } catch (_) {
            /* focus is best-effort */
          }
        } catch (_) {
          /* ignore malformed events */
        }
      };
      return () => {
        try {
          source.close();
        } catch (_) {
          /* ignore */
        }
      };
    }

    function apply(ctx) {
      try {
        ctx.effect(() => connectOpenEvents(ctx), 'desktop-notify: open-session events');
      } catch (error) {
        console.error('[desktop-notify] open-session events failed', error);
      }
      try {
        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register(
            {
              name: 'conversation.composer.dock',
              id: 'desktop-notify-active-session',
              order: -100,
            },
            ActiveSessionReporter,
          ),
        );
      } catch (error) {
        console.error('[desktop-notify] active-session reporter failed', error);
      }
    }

    return { inject: ['slots'], apply };
  },
});
