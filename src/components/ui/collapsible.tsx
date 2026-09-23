import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cn } from '../../lib/utils'

interface CollapsibleContextValue {
  open: boolean
  onOpenChange: (open: boolean) => void
  disabled?: boolean
}

const CollapsibleContext = React.createContext<CollapsibleContextValue | null>(null)

export function useCollapsible() {
  const context = React.useContext(CollapsibleContext)
  if (!context) {
    throw new Error('useCollapsible must be used within a Collapsible')
  }
  return context
}

export interface CollapsibleProps extends React.HTMLAttributes<HTMLDivElement> {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  disabled?: boolean
  asChild?: boolean
}

export const Collapsible = React.forwardRef<HTMLDivElement, CollapsibleProps>(
  (
    {
      open: controlledOpen,
      defaultOpen = false,
      onOpenChange,
      disabled = false,
      asChild = false,
      className,
      children,
      ...props
    },
    ref
  ) => {
    const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen)
    const isControlled = controlledOpen !== undefined
    const open = isControlled ? controlledOpen : uncontrolledOpen

    const handleOpenChange = React.useCallback(
      (nextOpen: boolean) => {
        if (disabled) return
        if (!isControlled) {
          setUncontrolledOpen(nextOpen)
        }
        onOpenChange?.(nextOpen)
      },
      [disabled, isControlled, onOpenChange]
    )

    const Comp = asChild ? Slot : 'div'

    return (
      <CollapsibleContext.Provider value={{ open, onOpenChange: handleOpenChange, disabled }}>
        <Comp
          ref={ref}
          data-state={open ? 'open' : 'closed'}
          data-disabled={disabled ? '' : undefined}
          className={cn('collapsible-root', className)}
          {...props}
        >
          {children}
        </Comp>
      </CollapsibleContext.Provider>
    )
  }
)
Collapsible.displayName = 'Collapsible'

export interface CollapsibleTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean
}

export const CollapsibleTrigger = React.forwardRef<HTMLButtonElement, CollapsibleTriggerProps>(
  ({ asChild = false, onClick, className, children, ...props }, ref) => {
    const { open, onOpenChange, disabled } = useCollapsible()
    const Comp = asChild ? Slot : 'button'

    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      onClick?.(e)
      if (!e.defaultPrevented && !disabled) {
        onOpenChange(!open)
      }
    }

    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : 'button'}
        aria-expanded={open}
        data-state={open ? 'open' : 'closed'}
        disabled={disabled}
        className={cn('collapsible-trigger', className)}
        onClick={handleClick}
        {...props}
      >
        {children}
      </Comp>
    )
  }
)
CollapsibleTrigger.displayName = 'CollapsibleTrigger'

export interface CollapsibleContentProps extends React.HTMLAttributes<HTMLDivElement> {
  asChild?: boolean
  forceMount?: boolean
}

export const CollapsibleContent = React.forwardRef<HTMLDivElement, CollapsibleContentProps>(
  ({ asChild = false, forceMount = false, className, children, ...props }, ref) => {
    const { open } = useCollapsible()
    if (!open && !forceMount) {
      return null
    }

    const Comp = asChild ? Slot : 'div'

    return (
      <Comp
        ref={ref}
        data-state={open ? 'open' : 'closed'}
        className={cn('collapsible-content overflow-hidden', className)}
        {...props}
      >
        {children}
      </Comp>
    )
  }
)
CollapsibleContent.displayName = 'CollapsibleContent'
