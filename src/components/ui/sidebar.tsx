import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

// ==========================================
// 1. 基础侧边栏容器
// ==========================================

export const Sidebar = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <aside
    ref={ref}
    data-sidebar="sidebar"
    className={cn(
      'flex h-full w-full flex-col overflow-hidden bg-[var(--color-sidebar)] text-[var(--color-text)]',
      className
    )}
    {...props}
  />
))
Sidebar.displayName = 'Sidebar'

export const SidebarHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-sidebar="header"
    className={cn('flex flex-shrink-0 flex-col', className)}
    {...props}
  />
))
SidebarHeader.displayName = 'SidebarHeader'

export const SidebarContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-sidebar="content"
    className={cn(
      'flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden scrollbar-none',
      className
    )}
    {...props}
  />
))
SidebarContent.displayName = 'SidebarContent'

export const SidebarFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-sidebar="footer"
    className={cn('flex flex-shrink-0 flex-col p-2', className)}
    {...props}
  />
))
SidebarFooter.displayName = 'SidebarFooter'

export const SidebarSeparator = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-sidebar="separator"
    className={cn('mx-2 my-1 h-px bg-[var(--color-border)]', className)}
    {...props}
  />
))
SidebarSeparator.displayName = 'SidebarSeparator'

// ==========================================
// 2. 分组组件体系
// ==========================================

export const SidebarGroup = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-sidebar="group"
    className={cn('relative flex w-full min-w-0 flex-col py-1', className)}
    {...props}
  />
))
SidebarGroup.displayName = 'SidebarGroup'

export interface SidebarGroupLabelProps
  extends React.HTMLAttributes<HTMLDivElement> {
  asChild?: boolean
}

export const SidebarGroupLabel = React.forwardRef<
  HTMLDivElement,
  SidebarGroupLabelProps
>(({ className, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : 'div'
  return (
    <Comp
      ref={ref}
      data-sidebar="group-label"
      className={cn(
        'flex h-7 shrink-0 items-center rounded-md px-2 text-xs font-semibold tracking-wider text-[var(--color-text-muted)] outline-none transition-colors ease-linear focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]',
        className
      )}
      {...props}
    />
  )
})
SidebarGroupLabel.displayName = 'SidebarGroupLabel'

export const SidebarGroupAction = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }
>(({ className, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp
      ref={ref}
      type="button"
      data-sidebar="group-action"
      className={cn(
        'absolute right-2 top-1.5 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-[var(--color-text-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]',
        className
      )}
      {...props}
    />
  )
})
SidebarGroupAction.displayName = 'SidebarGroupAction'

export const SidebarGroupContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-sidebar="group-content"
    className={cn('w-full min-w-0', className)}
    {...props}
  />
))
SidebarGroupContent.displayName = 'SidebarGroupContent'

// ==========================================
// 3. 菜单及菜单项组件
// ==========================================

export const SidebarMenu = React.forwardRef<
  HTMLUListElement,
  React.HTMLAttributes<HTMLUListElement>
>(({ className, ...props }, ref) => (
  <ul
    ref={ref}
    data-sidebar="menu"
    className={cn('flex w-full min-w-0 flex-col gap-0.5 list-none m-0 p-0', className)}
    {...props}
  />
))
SidebarMenu.displayName = 'SidebarMenu'

export const SidebarMenuItem = React.forwardRef<
  HTMLLIElement,
  React.LiHTMLAttributes<HTMLLIElement>
>(({ className, ...props }, ref) => (
  <li
    ref={ref}
    data-sidebar="menu-item"
    className={cn('group/menu-item relative list-none m-0 p-0', className)}
    {...props}
  />
))
SidebarMenuItem.displayName = 'SidebarMenuItem'

const sidebarMenuButtonVariants = cva(
  'peer/menu-button flex w-full items-center gap-2 overflow-hidden rounded-md px-2 py-1 text-left text-xs font-medium outline-none transition-colors hover:bg-[var(--color-hover)] hover:text-[var(--color-text)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 select-none cursor-pointer',
  {
    variants: {
      variant: {
        default: 'text-[var(--color-text)] hover:bg-[var(--color-hover)]',
        ghost: 'text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text)]',
      },
      size: {
        default: 'h-7 text-xs',
        sm: 'h-6 text-[11px]',
        lg: 'h-8 text-sm',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

export interface SidebarMenuButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof sidebarMenuButtonVariants> {
  asChild?: boolean
  isActive?: boolean
}

export const SidebarMenuButton = React.forwardRef<
  HTMLButtonElement,
  SidebarMenuButtonProps
>(({ asChild = false, isActive = false, variant = 'default', size = 'default', className, ...props }, ref) => {
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : 'button'}
      data-sidebar="menu-button"
      data-active={isActive}
      className={cn(
        sidebarMenuButtonVariants({ variant, size }),
        isActive && 'bg-[var(--color-active)] text-[var(--color-text)] font-semibold shadow-xs',
        className
      )}
      {...props}
    />
  )
})
SidebarMenuButton.displayName = 'SidebarMenuButton'

export const SidebarMenuSub = React.forwardRef<
  HTMLUListElement,
  React.HTMLAttributes<HTMLUListElement>
>(({ className, ...props }, ref) => (
  <ul
    ref={ref}
    data-sidebar="menu-sub"
    className={cn(
      'mx-2.5 flex min-w-0 flex-col gap-0.5 border-l border-[var(--color-border)] px-2 py-0.5 list-none m-0',
      className
    )}
    {...props}
  />
))
SidebarMenuSub.displayName = 'SidebarMenuSub'

export const SidebarMenuSubItem = React.forwardRef<
  HTMLLIElement,
  React.LiHTMLAttributes<HTMLLIElement>
>(({ className, ...props }, ref) => (
  <li ref={ref} className={cn('list-none m-0 p-0', className)} {...props} />
))
SidebarMenuSubItem.displayName = 'SidebarMenuSubItem'

export const SidebarMenuSubButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean; isActive?: boolean }
>(({ asChild = false, isActive = false, className, ...props }, ref) => {
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : 'button'}
      data-sidebar="menu-sub-button"
      data-active={isActive}
      className={cn(
        'flex h-6 min-w-0 items-center gap-2 overflow-hidden rounded-md px-2 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] data-[active=true]:bg-[var(--color-active)] data-[active=true]:text-[var(--color-text)] select-none cursor-pointer',
        className
      )}
      {...props}
    />
  )
})
SidebarMenuSubButton.displayName = 'SidebarMenuSubButton'
