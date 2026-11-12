import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { TOOLS, COMMANDS, ROOT, checkSpecConsistency } = require('../../scripts/mcp-server.cjs')

const NAMES: string[] = TOOLS.map((t: { name: string }) => t.name)
const FORBIDDEN = [
  'delete_all_data', 'deleteAllData', 'run_shell', 'exec_command',
  'write_db', 'drop_table', 'set_api_key', 'clear_api_key',
]

describe('unit: MCP server tool definitions', () => {
  it('exposes the complete read-only tool set with usable descriptions', () => {
    expect(NAMES).toHaveLength(18)
    expect(new Set(NAMES).size).toBe(18)
    for (const t of TOOLS) {
      expect(t.description.length).toBeGreaterThan(10)
      expect(t.inputSchema.type).toBe('object')
      expect(t.inputSchema.additionalProperties).toBe(false)
      expect(typeof t.handler).toBe('function')
    }
    expect(NAMES).toContain('get_storage_info')
    expect(NAMES).toContain('list_wrong_words')
    expect(NAMES).toContain('get_session')
    expect(NAMES).toContain('check_spec_consistency')
  })

  it('never exposes destructive tools or arbitrary command execution', () => {
    for (const bad of FORBIDDEN) expect(NAMES).not.toContain(bad)
    for (const t of TOOLS) {
      // Only command tools have no data handler of their own; none may accept
      // a free-form command/path argument.
      const props = t.inputSchema.properties ?? {}
      expect(props).not.toHaveProperty('cmd')
      expect(props).not.toHaveProperty('command')
      expect(props).not.toHaveProperty('shell')
    }
  })

  it('the command whitelist only references real npm scripts', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
    for (const [tool, cfg] of Object.entries(COMMANDS) as [string, { scripts: string[]; timeout: number }][]) {
      expect(NAMES).toContain(tool)
      expect(cfg.scripts.length).toBeGreaterThan(0)
      for (const script of cfg.scripts) expect(pkg.scripts).toHaveProperty(script)
      expect(cfg.timeout).toBeGreaterThan(0)
    }
  })

  it('spec/code consistency check passes on the current tree', () => {
    const r = checkSpecConsistency()
    expect(r.ok).toBe(true)
    expect(r.passed).toBe(r.total)
    expect(r.knownDocDrift.length).toBeGreaterThan(0)
    // git HEAD is reported as information, not a failing invariant.
    expect(typeof r.gitHead).toBe('string')
  })
})
