import * as RadixDialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/utils/cn'

export const Dialog = RadixDialog.Root
export const DialogTrigger = RadixDialog.Trigger

interface DialogContentProps extends RadixDialog.DialogContentProps {
  title?: string
  description?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
}

const sizeMap = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
}

export function DialogContent({ children, title, description, size = 'md', className, ...props }: DialogContentProps) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
      <RadixDialog.Content
        className={cn(
          'fixed left-[50%] top-[50%] z-50 translate-x-[-50%] translate-y-[-50%]',
          'w-full bg-card border border-border shadow-2xl rounded-xl p-6',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          'data-[state=closed]:slide-out-to-left-1/2 data-[state=open]:slide-in-from-left-1/2',
          sizeMap[size],
          className
        )}
        {...props}
      >
        <div className="flex items-start justify-between mb-5">
          <div>
            {title && <RadixDialog.Title className="text-lg font-semibold text-foreground">{title}</RadixDialog.Title>}
            {description && <RadixDialog.Description className="text-sm text-muted-foreground mt-1">{description}</RadixDialog.Description>}
          </div>
          <RadixDialog.Close className="rounded-lg p-1.5 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors ml-4 flex-shrink-0">
            <X size={16} />
          </RadixDialog.Close>
        </div>
        {children}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  )
}
