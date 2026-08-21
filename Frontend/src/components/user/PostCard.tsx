import React from 'react';
import type { Post, PostStatus, PlatformPublishState } from '../../types';
import { Badge, type BadgeTone } from '../ui/Badge';
import { platformIcons } from './PlatformStatus';
import { formatDate } from '../../utils/format';

export const postStatusTone: Record<PostStatus, BadgeTone> = {
  published: 'emerald',
  scheduled: 'indigo',
  draft: 'slate',
  failed: 'red',
  partial: 'amber',
};

const platformPublishTone: Record<PlatformPublishState['status'], BadgeTone> = {
  published: 'emerald',
  failed: 'red',
  skipped: 'slate',
};

export function PostStatusBadge({ status }: {status: PostStatus;}) {
  return <Badge tone={postStatusTone[status]}>{status}</Badge>;
}

export function PlatformPublishBadges({ statuses }: {statuses: NonNullable<Post['platformStatuses']>;}) {
  const entries = (Object.entries(statuses) as Array<[string, PlatformPublishState]>)
    .filter(([, s]) => s.status !== 'skipped');
  if (entries.length === 0) return <span className="text-xs text-slate-400">—</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {entries.map(([platform, s]) => {
        const Icon = platformIcons[platform as keyof typeof platformIcons] ?? platformIcons.instagram;
        return (
          <span key={platform} className="inline-flex items-center gap-1" title={s.error || s.permalink || undefined}>
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            <Badge tone={platformPublishTone[s.status]}>{s.status}</Badge>
          </span>
        );
      })}
    </span>
  );
}

export function PostCard({ post, action }: {post: Post;action?: React.ReactNode;}) {
  const Icon = platformIcons[post.platform];
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-300">
          <Icon className="h-4 w-4" aria-hidden="true" />
          <span className="capitalize">{post.platform}</span>
        </span>
        {post.platformStatuses && Object.keys(post.platformStatuses).length > 1
          ? <PlatformPublishBadges statuses={post.platformStatuses} />
          : <PostStatusBadge status={post.status} />}
      </div>
      <p className="mt-3 text-sm text-slate-700 dark:text-slate-300">{post.caption}</p>
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="font-mono text-xs text-slate-400">
          {formatDate(post.date)} · {post.tokens} tokens
        </p>
        {action}
      </div>
    </article>);

}