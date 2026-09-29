import { describe, expect, it } from 'vitest'
import { planAgentProposalSync } from '../agent-proposal-sync'
import type { AgentProposalCommitEvent } from '../../shared/ipc-channels'

const session = { projectId: 'main', leaseId: 'lease-1', projectPath: 'C:\\novel' }

function commitEvent(overrides?: Partial<AgentProposalCommitEvent>): AgentProposalCommitEvent {
  return {
    proposalId: 'proposal-1',
    projectId: 'main',
    proposalType: 'propose_draft_update',
    receipt: {
      proposalId: 'proposal-1',
      projectId: 'main',
      resource: 'draft',
      draftId: 7,
      revision: 'a'.repeat(64),
      committedAt: '2026-09-29 00:00:00',
    },
    projectPath: 'C:\\novel',
    projectSession: session,
    ...overrides,
  }
}

describe('agent proposal commit sync plan', () => {
  it('drops events whose frozen project session is no longer active', () => {
    expect(planAgentProposalSync(commitEvent(), false, [])).toMatchObject({ applies: false })
  })

  it('targets only editor tabs of the committed draft within the same project', () => {
    const tabs = [
      { id: 'clean-same-draft', projectKey: 'C:\\novel', filePath: 'vela://draft/7', dirty: false },
      { id: 'dirty-manuscript', projectKey: 'c:\\NOVEL', filePath: 'vela://manuscript/7', dirty: true },
      { id: 'other-draft', projectKey: 'C:\\novel', filePath: 'vela://draft/8', dirty: false },
      { id: 'other-project', projectKey: 'C:\\elsewhere', filePath: 'vela://draft/7', dirty: false },
    ]
    expect(planAgentProposalSync(commitEvent(), true, tabs)).toMatchObject({
      applies: true,
      resources: ['drafts', 'fileTree'],
      draftId: 7,
      cleanDraftTabIds: ['clean-same-draft'],
      dirtyDraftTabIds: ['dirty-manuscript'],
    })
  })

  it('plans blueprint refreshes without touching editor tabs', () => {
    const event = commitEvent({
      proposalType: 'propose_blueprint_update',
      receipt: {
        proposalId: 'proposal-2',
        projectId: 'main',
        resource: 'blueprint',
        chapterNumber: 3,
        revision: 'b'.repeat(64),
        committedAt: '2026-09-29 00:00:00',
      },
    })
    expect(planAgentProposalSync(event, true, [
      { id: 'tab-1', projectKey: 'C:\\novel', filePath: 'vela://draft/7', dirty: false },
    ])).toMatchObject({
      applies: true,
      resources: ['blueprints', 'fileTree'],
      draftId: null,
      cleanDraftTabIds: [],
      dirtyDraftTabIds: [],
    })
  })
})
