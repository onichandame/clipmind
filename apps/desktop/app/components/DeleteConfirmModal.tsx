import { ConfirmDialog } from './ConfirmDialog';

export function DeleteConfirmModal({
  onCancel,
  onConfirm,
  title = '确认删除项目？',
  description = '将删除此项目及其中内容。素材库中的素材不会被删除。此操作不可撤销。',
  isPending = false,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  title?: string;
  description?: string;
  isPending?: boolean;
}) {
  return (
    <ConfirmDialog
      title={title}
      description={description}
      confirmLabel="确认删除"
      variant="danger"
      isPending={isPending}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
