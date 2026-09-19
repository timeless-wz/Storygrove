import { useEffect, useMemo, useState } from 'react'
import { UserPlus } from 'lucide-react'
import {
  DEFAULT_CHARACTER_CREATION_ROLE,
  getCharacterRoleLabels,
} from '../../shared/character-role'
import { characterRosterIdentityKey } from '../../shared/character-roster'
import { useLocaleStore } from '../../stores/locale-store'
import type {
  CharacterCreationRequest,
  CharacterCreationResult,
} from '../../stores/character-store'
import { Button } from '../ui/Button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/Dialog'
import { Input } from '../ui/Input'
import { Label } from '../ui/Label'
import { NativeSelect } from '../ui/NativeSelect'

/** 新建浮层给出的定位选项，顺序即展示顺序；默认是最后一项“暂未设定”。 */
const CREATION_ROLE_OPTIONS = ['protagonist', 'antagonist', 'supporting', 'minor', DEFAULT_CHARACTER_CREATION_ROLE] as const

type CreationError = 'empty_name' | 'duplicate_name' | 'not_ready'

interface CharacterCreateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 当前名单里已存在的姓名，用于即时提示重名。 */
  existingNames: readonly string[]
  create: (request: CharacterCreationRequest) => CharacterCreationResult
  /** 创建成功后由调用方负责选中新角色并进入编辑档案。 */
  onCreated: (name: string) => void
}

/**
 * 新建角色浮层。
 *
 * 点“新建角色”不再立刻落一张“新角色_xxx / 配角”的卡片：姓名必填、定位可选，
 * 未选择定位时创建为“暂未设定”。校验失败不会写入任何状态，因此不会留下幽灵角色。
 */
export default function CharacterCreateDialog({
  open,
  onOpenChange,
  existingNames,
  create,
  onCreated,
}: CharacterCreateDialogProps) {
  const text = useLocaleStore(s => s.text)
  const [name, setName] = useState('')
  const [role, setRole] = useState<string>(DEFAULT_CHARACTER_CREATION_ROLE)
  const [error, setError] = useState<CreationError | null>(null)

  const existingIdentityKeys = useMemo(
    () => new Set(existingNames.map(characterRosterIdentityKey)),
    [existingNames],
  )

  // 每次打开都从空白开始，避免上一次的输入或错误残留。
  useEffect(() => {
    if (!open) return
    setName('')
    setRole(DEFAULT_CHARACTER_CREATION_ROLE)
    setError(null)
  }, [open])

  const errorMessage = (kind: CreationError): string => {
    if (kind === 'empty_name') return text('请填写角色姓名', 'Enter a character name')
    if (kind === 'duplicate_name') return text('该姓名已存在，请换一个', 'That name already exists')
    return text('角色数据尚未就绪，请稍后重试', 'Character data is not ready yet. Try again in a moment.')
  }

  const handleNameChange = (value: string) => {
    setName(value)
    const trimmed = value.trim()
    if (!trimmed) {
      setError(null)
      return
    }
    setError(existingIdentityKeys.has(characterRosterIdentityKey(trimmed)) ? 'duplicate_name' : null)
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError('empty_name')
      return
    }
    const result = create({ name: trimmed, role: role as CharacterCreationRequest['role'] })
    if (!result.ok) {
      setError(result.reason)
      return
    }
    onOpenChange(false)
    onCreated(result.name)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" data-testid="character-create-dialog">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{text('新建角色', 'New character')}</DialogTitle>
            <DialogDescription>
              {text(
                '先填写姓名；定位可以之后随时修改。',
                'Start with a name. You can change the role at any time.',
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 px-6 py-4">
            <div>
              <Label htmlFor="character-create-name">{text('姓名', 'Name')}</Label>
              <Input
                id="character-create-name"
                value={name}
                autoFocus
                aria-label={text('角色姓名', 'Character name')}
                aria-invalid={error === 'empty_name' || error === 'duplicate_name'}
                placeholder={text('例如：沈砺', 'For example: Shen Li')}
                onChange={(event) => handleNameChange(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="character-create-role">{text('定位', 'Role')}</Label>
              <NativeSelect
                id="character-create-role"
                value={role}
                aria-label={text('角色定位', 'Character role')}
                onChange={(event) => setRole(event.target.value)}
              >
                {CREATION_ROLE_OPTIONS.map((option) => {
                  const labels = getCharacterRoleLabels(option)
                  return <option key={option} value={option}>{text(labels.zhCN, labels.enUS)}</option>
                })}
              </NativeSelect>
            </div>
            {error && (
              <p
                role="alert"
                data-testid="character-create-error"
                className="text-[11px]"
                style={{ color: 'var(--color-warning-text)' }}
              >
                {errorMessage(error)}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {text('取消', 'Cancel')}
            </Button>
            <Button type="submit">
              <UserPlus size={12} /> {text('创建角色', 'Create character')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export { CharacterCreateDialog }
export type { CharacterCreateDialogProps }
