/**
 * 世界资料的表单原语。
 *
 * 只封装「怎么摆放字段」，不封装数据模型：每个实体的字段与校验仍在各自的
 * 仓库与业务里。节点/世界/人物选择器都从既有 store 读取，不复制事实。
 */
import { useEffect, useMemo, useState } from 'react'

import type { WorldMapNode } from '../../shared/world-map'
import type { WorldCharacterRef } from '../../shared/world-workbench'
import { useLocaleStore } from '../../stores/locale-store'
import { useWorldMapStore } from '../../stores/world-map-store'
import { Button } from '../ui/Button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/Dialog'
import { Input } from '../ui/Input'
import { NativeSelect } from '../ui/NativeSelect'
import { Switch } from '../ui/Switch'
import { Textarea } from '../ui/Textarea'

const inputClass = 'w-full text-xs'
const labelClass = 'mb-1 block text-xs font-medium text-[var(--color-text-secondary)]'

export interface FormFieldOption {
  value: string
  label: string
}

export type FormFieldKind = 'text' | 'textarea' | 'select' | 'number' | 'switch'

export interface FormFieldSpec {
  key: string
  label: string
  kind: FormFieldKind
  placeholder?: string
  /** 选项可以是静态列表，也可以随当前表单值变化（例如通道两端的世界决定可选地点）。 */
  options?: FormFieldOption[] | ((values: FormValues) => FormFieldOption[])
  hint?: string
  /** 只有满足条件的字段才展示（例如自定义类型才显示自定义名称）。 */
  visibleWhen?: (values: Record<string, string | boolean>) => boolean
  /** 只读展示（例如生成的世界名）。 */
  readOnly?: boolean
}

export type FormValues = Record<string, string | boolean>

function stringOf(value: string | boolean | undefined): string {
  return typeof value === 'string' ? value : ''
}

function booleanOf(value: string | boolean | undefined): boolean {
  return value === true
}

/** 通用的实体表单对话框：字段由调用方给出，保存结果由调用方决定。 */
export function EntityFormDialog({
  open,
  title,
  description,
  fields,
  initialValues,
  saving,
  submitLabel,
  errorText,
  onClose,
  onSubmit,
}: {
  open: boolean
  title: string
  description?: string
  fields: FormFieldSpec[]
  initialValues: FormValues
  saving?: boolean
  submitLabel?: string
  errorText?: string | null
  onClose: () => void
  onSubmit: (values: FormValues) => void | Promise<void>
}) {
  const text = useLocaleStore(s => s.text)
  const [values, setValues] = useState<FormValues>(initialValues)

  // 每次打开都用最新的实体内容初始化，避免残留上一次编辑的输入。
  useEffect(() => {
    if (open) setValues(initialValues)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const visibleFields = useMemo(
    () => fields
      .filter(field => !field.visibleWhen || field.visibleWhen(values))
      .map(field => ({
        ...field,
        options: typeof field.options === 'function' ? field.options(values) : field.options,
      })),
    [fields, values],
  )

  const update = (key: string, value: string | boolean) => {
    setValues(previous => ({ ...previous, [key]: value }))
  }

  return (
    <Dialog open={open} onOpenChange={next => { if (!next) onClose() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {description && (
          <p className="text-xs text-[var(--color-text-muted)]">{description}</p>
        )}
        <div className="max-h-[60vh] space-y-3 overflow-y-auto px-1 py-2">
          {visibleFields.map(field => (
            <div key={field.key}>
              <label className={labelClass} htmlFor={`world-field-${field.key}`}>{field.label}</label>
              {field.kind === 'textarea' && (
                <Textarea
                  id={`world-field-${field.key}`}
                  className={inputClass}
                  rows={3}
                  value={stringOf(values[field.key])}
                  placeholder={field.placeholder}
                  readOnly={field.readOnly}
                  onChange={event => update(field.key, event.target.value)}
                />
              )}
              {field.kind === 'select' && (
                <NativeSelect
                  id={`world-field-${field.key}`}
                  className={inputClass}
                  value={stringOf(values[field.key])}
                  onChange={event => update(field.key, event.target.value)}
                >
                  {(field.options ?? []).map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </NativeSelect>
              )}
              {field.kind === 'switch' && (
                <div className="flex items-center gap-2">
                  <Switch
                    checked={booleanOf(values[field.key])}
                    onCheckedChange={next => update(field.key, next)}
                  />
                  {field.placeholder && (
                    <span className="text-xs text-[var(--color-text-muted)]">{field.placeholder}</span>
                  )}
                </div>
              )}
              {(field.kind === 'text' || field.kind === 'number') && (
                <Input
                  id={`world-field-${field.key}`}
                  className={inputClass}
                  type={field.kind === 'number' ? 'number' : 'text'}
                  value={stringOf(values[field.key])}
                  placeholder={field.placeholder}
                  readOnly={field.readOnly}
                  onChange={event => update(field.key, event.target.value)}
                />
              )}
              {field.hint && (
                <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">{field.hint}</p>
              )}
            </div>
          ))}
        </div>
        {errorText && (
          <p className="text-xs text-[var(--color-error-text,var(--color-danger,#dc2626))]" role="alert">{errorText}</p>
        )}
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {text('取消', 'Cancel')}
          </Button>
          <Button size="sm" disabled={saving} onClick={() => void onSubmit(values)}>
            {saving ? text('保存中…', 'Saving…') : (submitLabel ?? text('保存', 'Save'))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 世界内的地图地点选择器选项；只列出属于该世界的地图里的地点。 */
export function useWorldNodeOptions(worldId: string | null, mapWorldLinks: Array<{ mapId: string; worldId: string }>) {
  const nodes = useWorldMapStore(s => s.nodes)
  const maps = useWorldMapStore(s => s.maps)
  return useMemo(() => {
    if (!worldId) return [] as Array<{ value: string; label: string }>
    const mapIds = new Set(mapWorldLinks.filter(link => link.worldId === worldId).map(link => link.mapId))
    const mapNameById = new Map(maps.map(map => [map.id, map.name]))
    return nodes
      .filter((node: WorldMapNode) => mapIds.has(node.mapId))
      .map(node => ({
        value: node.id,
        label: `${mapNameById.get(node.mapId) ?? node.mapId} / ${node.name}`,
      }))
      .sort((left, right) => left.label.localeCompare(right.label))
  }, [worldId, mapWorldLinks, nodes, maps])
}

export function useCharacterOptions(characterRefs: WorldCharacterRef[]) {
  return useMemo(
    () => characterRefs.map(ref => ({
      value: ref.id,
      label: ref.locationText ? `${ref.name}（${ref.locationText}）` : ref.name,
    })),
    [characterRefs],
  )
}

/** 「未选定」选项放在最前，保证「未知/未设定」始终可表达。 */
export function withUnset(options: FormFieldOption[], label: string): FormFieldOption[] {
  return [{ value: '', label }, ...options]
}

export function fieldValue(values: FormValues, key: string): string {
  return stringOf(values[key]).trim()
}

export function fieldFlag(values: FormValues, key: string): boolean {
  return booleanOf(values[key])
}

export const FORM_INPUT_CLASS = inputClass
