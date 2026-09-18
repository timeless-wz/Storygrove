import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Check, X, Sparkles, MapPin } from 'lucide-react'
import { useLocaleStore } from '../../stores/locale-store'
import {
  type WorldMapCandidate,
  type WorldMapLayer,
  WORLD_MAP_NODE_TYPE_LABELS,
  getWorldMapLayerName,
} from '../../shared/world-map'

interface Props {
  open: boolean
  candidates: WorldMapCandidate[]
  layers: WorldMapLayer[]
  loading: boolean
  onClose: () => void
  onConfirm: (candidate: WorldMapCandidate) => Promise<boolean>
  onDismiss: (candidateId: string) => void
}

export default function WorldMapCandidatesModal({
  open,
  candidates,
  layers,
  loading,
  onClose,
  onConfirm,
  onDismiss,
}: Props) {
  const text = useLocaleStore(s => s.text)

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles size={16} style={{ color: 'var(--color-accent)' }} />
            <span>{text('从项目资料中发现的待确认地理候选', 'Candidate Map Locations from Project Materials')}</span>
          </DialogTitle>
        </DialogHeader>

        <p className="text-xs text-[var(--color-text-muted)]">
          {text(
            '以下是从已有世界观、设定清单或探索资料标题中提取的地名候选。系统绝不会将候选自动写入地图；必须由作者逐条确认采纳，方可成为正式地图节点。',
            'These candidate locations were extracted from existing setting documents and exploration files. They will never become formal map nodes without your explicit confirmation.',
          )}
        </p>

        <div className="flex-1 overflow-y-auto space-y-2 py-3 pr-1">
          {loading ? (
            <div className="text-center py-8 text-xs text-[var(--color-text-muted)]">
              {text('正在扫描已有资料标题...', 'Scanning existing materials...')}
            </div>
          ) : candidates.length === 0 ? (
            <div className="text-center py-8 text-xs text-[var(--color-text-muted)]">
              {text('暂无待确认的地理候选，所有资料提及地点已确认或未发现明显地标标题。', 'No candidate locations found. All detected places have been confirmed.')}
            </div>
          ) : (
            candidates.map(cand => (
              <div
                key={cand.id}
                className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] flex items-start justify-between gap-3"
              >
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <MapPin size={14} style={{ color: 'var(--color-accent)' }} />
                    <span className="font-semibold text-xs text-[var(--color-text)]">
                      {cand.name}
                    </span>
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded"
                      style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-text-secondary)' }}
                    >
                      {text(WORLD_MAP_NODE_TYPE_LABELS[cand.type]?.zh || cand.type, cand.type)}
                    </span>
                    {cand.suggestedLayer && (
                      <span className="text-[10px] text-[var(--color-text-muted)]">
                        {text(
                          getWorldMapLayerName(layers, cand.suggestedLayer),
                          getWorldMapLayerName(layers, cand.suggestedLayer),
                        )}
                      </span>
                    )}
                  </div>
                  {cand.description && (
                    <p className="text-xs text-[var(--color-text-secondary)] line-clamp-2">
                      {cand.description}
                    </p>
                  )}
                  <p className="text-[10px] text-[var(--color-text-muted)]">
                    {text(`来源：${cand.sourceRef}`, `Source: ${cand.sourceRef}`)}
                  </p>
                </div>

                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onDismiss(cand.id)}
                    title={text('忽略此候选', 'Dismiss')}
                  >
                    <X size={12} />
                    {text('忽略', 'Dismiss')}
                  </Button>
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => void onConfirm(cand)}
                    title={text('确认采纳并添加到地图', 'Confirm & Add to Map')}
                  >
                    <Check size={12} />
                    {text('确认添加', 'Confirm')}
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {text('完成', 'Done')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
