import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { closeProjectDatabase, getProjectDb, initProjectDatabase } from '../../database'
import { approveAgentProposal, listAgentProposals } from '../agent-proposal-service'

const roots: string[] = []
afterEach(() => { closeProjectDatabase(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })
describe('agent proposal approval boundary', () => {
  it('requires a pending proposal and marks it approved in the author boundary', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-proposal-')); roots.push(root); initProjectDatabase(root)
    const db = getProjectDb()!; db.prepare("INSERT INTO agent_proposals (proposal_id,project_id,session_id,proposal_type,payload_json,base_revision) VALUES ('p','main','s','propose_fact_update','{}','0')").run()
    expect(approveAgentProposal('main', 'p', 'author')).toMatchObject({ proposalId: 'p', status: 'approved' }); expect(listAgentProposals('main', 'approved')).toHaveLength(1)
  })
})
