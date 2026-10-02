export interface MinutesComment {
  id: string;
  meetingId: string;
  anchorId: string;
  parentId: string | null;
  authorEmail: string;
  body: string;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MinutesCommentThread {
  comment: MinutesComment;
  replies: MinutesComment[];
}

/** What the Minutes table needs to show and manage per-row comments. Each
 *  mutation resolves to whether the server accepted it. */
export interface MinutesCommentsApi {
  /** Top-level threads keyed by the matter/row id they are attached to. */
  threads: Map<string, MinutesCommentThread[]>;
  viewerEmail: string;
  isOwner: boolean;
  add: (anchorId: string, body: string, parentId?: string) => Promise<boolean>;
  edit: (id: string, body: string) => Promise<boolean>;
  setResolved: (id: string, resolved: boolean) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
}
