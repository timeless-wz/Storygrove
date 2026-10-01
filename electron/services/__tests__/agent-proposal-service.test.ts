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
    const db = getProjectDb()!
    db.prepare("INSERT INTO agent_sessions (session_id,project_id,agent_name,expected_revision,expires_at) VALUES ('s','main','fixture','0',datetime('now','+1 hour'))").run()
    db.prepare("INSERT INTO agent_proposals (proposal_id,project_id,session_id,proposal_type,payload_json,base_revision) VALUES ('p','main','s','propose_blueprint_update','{}','0')").run()
    expect(approveAgentProposal('main', 'p', 'author')).toMatchObject({ proposalId: 'p', status: 'approved' }); expect(listAgentProposals('main', 'approved')).toHaveLength(1)
    expect(db.prepare('SELECT approved_by FROM agent_proposals WHERE proposal_id = ?').get('p')).toEqual({ approved_by: 'author' })
    expect(() => approveAgentProposal('main', 'p', 'author')).toThrow('提案不存在')
  })
})
