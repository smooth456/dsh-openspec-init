/**
 * Client half of `dsh-openspec-init`.
 *
 * Renders the OpenSpec init button under the composer and runs the Host command
 * `/openspec-init`, which owns the check-then-init flow. The button shows only a
 * short state; the command's own result row in the conversation carries the
 * full report (workspace, CLI version, workspace state, init output).
 */

window.__ModuleLoader__.load({
  id: 'dsh-openspec-init',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Dictionary namespace owned by this plugin. */
    const NS = 'dsh-openspec-init'
    /** Host command this button executes. */
    const COMMAND = '/openspec-init'
    /** How long a success state stays on screen before returning to idle. */
    const SUCCESS_HOLD_MS = 6000

    /** Simplified Chinese dictionary (the key-set source of truth). */
    const zh = {
      'button.label': 'OpenSpec 初始化',
      'button.running': '检查并初始化中…',
      'button.done': '已初始化',
      'button.failed': '初始化失败',
      'button.title': '检查 openspec 是否安装、当前工作区是否已初始化，然后执行 openspec init --tools dsh',
      'button.aria': 'OpenSpec 初始化',
      'error.unavailable': '无法执行 /openspec-init 命令',
    }

    /** English dictionary, checked complete against the zh key set. */
    const en = {
      'button.label': 'OpenSpec init',
      'button.running': 'Checking…',
      'button.done': 'Initialized',
      'button.failed': 'Init failed',
      'button.title': 'Check whether openspec is installed and this workspace is initialized, then run openspec init --tools dsh',
      'button.aria': 'Initialize OpenSpec',
      'error.unavailable': 'Could not run the /openspec-init command',
    }

    /** Host-token-only styles; the class prefix keeps them local to this plugin. */
    const css = [
      '.dsh-openspec-init-row{display:flex;align-items:center;gap:8px;min-width:0;min-height:24px}',
      '.dsh-openspec-init-button{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 8px;border-radius:6px;',
      'border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);',
      "font-family:inherit;font-size:12px;line-height:18px;cursor:pointer;white-space:nowrap;transition:color .12s,border-color .12s;flex:none}",
      '.dsh-openspec-init-button:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}',
      '.dsh-openspec-init-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      '.dsh-openspec-init-button:disabled{opacity:.6;cursor:default}',
      '.dsh-openspec-init-glyph{width:12px;height:12px;flex:none}',
      '.dsh-openspec-init-state{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);',
      'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
      '.dsh-openspec-init-state[data-kind="success"]{color:var(--dsw-alias-state-success-primary)}',
      '.dsh-openspec-init-state[data-kind="error"]{color:var(--dsw-alias-state-error-primary)}',
      '.dsh-openspec-init-state[data-kind="running"]{color:var(--dsw-alias-label-secondary)}',
    ].join('')

    /** Small mark: a document with a checked corner. */
    function Glyph() {
      return h(
        'svg',
        {
          className: 'dsh-openspec-init-glyph',
          viewBox: '0 0 16 16',
          'aria-hidden': true,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        },
        h('path', { d: 'M4 1.9h5l3 3v9.2H4z' }),
        h('path', { d: 'M9 1.9v3h3' }),
        h('path', { d: 'M6 9.6l1.6 1.6L10.4 8' }),
      )
    }

    /**
     * The ambient button. `initWorkspace` resolves to `{ kind, text }`; the text
     * is only used as a hover detail because the command row shows the report.
     */
    function OpenSpecInitButton({ t, initWorkspace }) {
      const [phase, setPhase] = React.useState('idle')
      const [detail, setDetail] = React.useState(null)
      const alive = React.useRef(true)

      React.useEffect(() => {
        alive.current = true
        return () => {
          alive.current = false
        }
      }, [])

      React.useEffect(() => {
        if (phase !== 'success') return undefined
        const timer = setTimeout(() => {
          if (!alive.current) return
          setPhase('idle')
          setDetail(null)
        }, SUCCESS_HOLD_MS)
        return () => clearTimeout(timer)
      }, [phase])

      const running = phase === 'running'

      const start = () => {
        if (running) return
        setPhase('running')
        setDetail(null)
        initWorkspace().then(
          (outcome) => {
            if (!alive.current) return
            setPhase(outcome.kind)
            setDetail(outcome.text ?? null)
          },
          (reason) => {
            if (!alive.current) return
            setPhase('error')
            setDetail(reason instanceof Error ? reason.message : String(reason))
          },
        )
      }

      const stateText =
        phase === 'running'
          ? t('button.running')
          : phase === 'success'
            ? t('button.done')
            : phase === 'error'
              ? t('button.failed')
              : null

      return h(
        'div',
        { className: 'dsh-openspec-init-row' },
        h('style', { key: 'css' }, css),
        h(
          'button',
          {
            key: 'button',
            type: 'button',
            className: 'dsh-openspec-init-button',
            disabled: running,
            onClick: start,
            title: t('button.title'),
            'aria-label': t('button.aria'),
          },
          h(Glyph, { key: 'glyph' }),
          h('span', { key: 'label' }, running ? t('button.running') : t('button.label')),
        ),
        stateText === null
          ? null
          : h(
              'span',
              {
                key: 'state',
                className: 'dsh-openspec-init-state',
                'data-kind': phase,
                role: 'status',
                title: detail === null ? undefined : detail,
              },
              stateText,
            ),
      )
    }

    return {
      inject: ['slots', 'locale', 'remote', 'remote.commands'],
      apply(ctx) {
        const t = ctx.locale.bind(NS)
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-openspec-init: dictionaries')
        ctx.effect(
          () =>
            ctx.slots.inject('conversation.composer.dock', () =>
              ctx.slots.register(
                {
                  name: 'conversation.composer.dock',
                  id: 'dsh-openspec-init',
                  order: 5,
                  locale: NS,
                  inject: (sessionId) => ({
                    initWorkspace: async () => {
                      const reply = await ctx.remote.commands.execute(sessionId, COMMAND, [])
                      if (reply === undefined || reply.ok !== true) {
                        const failure = reply === undefined ? undefined : reply.error
                        return {
                          kind: 'error',
                          text:
                            failure === undefined
                              ? t('error.unavailable')
                              : `${failure.message} (${failure.code})`,
                        }
                      }
                      const execution = reply.value
                      if (execution === undefined) return { kind: 'error', text: t('error.unavailable') }
                      const result = execution.result
                      return result.kind === 'success'
                        ? { kind: 'success', text: result.text ?? null }
                        : { kind: 'error', text: result.text }
                    },
                  }),
                },
                OpenSpecInitButton,
              ),
            ),
          'dsh-openspec-init: composer dock entry',
        )
      },
    }
  },
})
