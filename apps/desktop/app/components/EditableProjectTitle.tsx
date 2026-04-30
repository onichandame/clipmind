import { useState, useEffect, useRef } from 'react';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { env } from '../env';
import { authFetch } from '../lib/auth';

interface EditableProjectTitleProps {
  projectId: string;
  initialTitle: string;
  className?: string;
}

export function EditableProjectTitle({ projectId, initialTitle, className = '' }: EditableProjectTitleProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    setTitle(initialTitle);
  }, [initialTitle]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isEditing]);

  const patchTitleMutation = useMutation({
    mutationFn: async (newTitle: string) => {
      const res = await authFetch(`${env.VITE_API_BASE_URL}/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle }),
      });
      if (!res.ok) throw new Error('Failed to update title');
      return res.json();
    },
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['project', projectId] });
          queryClient.invalidateQueries({ queryKey: ['projects'] });
        }
  });

  const handleBlur = () => {
    setIsEditing(false);
    const trimmed = title.trim();
    if (trimmed && trimmed !== initialTitle) {
      patchTitleMutation.mutate(trimmed);
    } else {
      setTitle(initialTitle);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleBlur();
    if (e.key === 'Escape') {
      setTitle(initialTitle);
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className={`bg-transparent border border-indigo-500/50 rounded outline-none px-2 py-0.5 text-base font-bold focus:ring-2 focus:ring-indigo-500/20 text-zinc-900 dark:text-zinc-100 ${className}`}
        style={{ minWidth: '200px' }}
      />
    );
  }

  return (
    <div
      onClick={() => setIsEditing(true)}
      className={`cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800/50 px-2 py-0.5 rounded text-base font-bold transition-colors border border-transparent text-zinc-900 dark:text-zinc-100 truncate ${className}`}
      title="点击修改项目名称"
    >
      {title || '未命名项目'}
    </div>
  );
}
