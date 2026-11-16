export const meta = {
  name: 'squish-ui-4',
  description: 'Squish Keeper UI: move Table / Float from Settings into the toolbar (owner decision 8, 2026-10-09)',
  phases: [{ title: 'Float', detail: 'one engineer: toolbar control, Settings row removed, harness rows re-specified' }],
}

const REPO = 'C:/Users/TestRun/Claude Claw/squish-keeper-build/games/wobblehoard'
const SCR = 'C:/Users/TestRun/AppData/Local/Temp/claude/C--Users-TestRun-AppData-Roaming-Claude-scratch-workspaces-10f6a62c-5610-424a-ba29-8c51dbde9f88-b3ecf43b-de12-4070-80de-e1daecc887bf-scratch-2026-10-06-8a5967/3b1103ab-0174-4d88-adc9-dd448a718f0d/scratchpad'

const LEG_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'partial', 'blocked'] },
    stepsDone: { type: 'array', items: { type: 'string' } },
    stepsNotDone: { type: 'array', items: { type: 'string' } },
    measured: { type: 'array', items: { type: 'string' } },
    filesChanged: { type: 'array', items: { type: 'string' } },
    pictures: { type: 'array', items: { type: 'string' } },
    reportPath: { type: 'string' },
    blockers: { type: 'array', items: { type: 'string' } },
  },
  required: ['status', 'stepsDone', 'stepsNotDone', 'measured', 'filesChanged', 'pictures', 'reportPath', 'blockers'],
}

phase('Float')
const r = await agent(`You are a senior front-end engineer on Squish Keeper (folder ${REPO}; Windows; Bash tool with POSIX syntax and forward slashes; scratch ${SCR}/ui/float/).
FIRST read ${REPO}/_handoff/briefs/UI_BUILD.md (the HARD BUDGET and environment rules bind you: 3 hours / about 250 tool calls, node entry points not npx, ports 5480 to 5489, no git write commands, tsc clean, never loosen a check), then section 1 (decision 8) and sections 4 and 6 of ${REPO}/_spec/UI.md, then the toolbar code (src/ui/toolbar.ts, toolbar.css, layout.ts, optionsBar) and where the gravity setting lives (src/ui/settingsPanel.ts row key 'gravity', src/ui/screens/screenCopy.ts SETTINGS_GROUPS, src/shell/hudBinding.ts, src/input/keyboard.ts G key, src/core/settings.ts).
OWNER (2026-10-09): "float/table should be in the toolbar, not in settings". TASK: add a two-state Table | Float control to the toolbar next to the tools (icons 'table' and 'float' exist in src/ui/icons.ts), in the More overflow on the tiny layout and fitting every layout of UI.md 4.2 (1280x800, 888x500, 390x844, 844x390, 568x320, 358x201, 320x568: no overlap with the name plate, meter ring, capsule dock or hint; every target >= 44x44), with a clear selected state, tooltip, live-region line ('Table' / 'Floating'), UI sound on / off, bound to the existing gravity setting and the G key (both stay in sync; the setting and its stored value stay); REMOVE the gravity row from the Settings panel (and its copy). Kit-page sheet at the 8 sizes (toolbar sections), re-spec every harness row that read the Settings gravity row with the written reason 'the owner moved Table / Float to the toolbar on 2026-10-09' (grep -n -i "gravity\\|wh-gravity\\|float" _harness/browser_shell.mjs _harness/shellview _harness/uikit), the toolbar keyboard walk (roving tabindex) includes the new control. Run tsc, probe_app, probe_uikit, probe_optbar and the browser sections you touch with --only= (toolbar, toolbar-phone, settings-panel-desktop, keyboard-only, reflow, hoard-meter-line). READ screenshots at 3 sizes as an art director. Write the running report block in ${REPO}/_handoff/reports/UI_RUN.md (a delimited 'FLOAT' block, at most 2 KB). Do not touch src/physics, src/render, src/shell/cut*.ts. The orchestrator commits.`, { label: 'Float: ui-float', phase: 'Float', schema: LEG_SCHEMA, model: 'sonnet' })
return r
