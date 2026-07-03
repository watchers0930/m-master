export type IdeaDocStatus = 'draft' | 'completed';
export type IdeaChannel = 'blog' | 'instagram' | 'facebook' | 'naver_cafe';
export type IdeaJobStatus = 'pending' | 'processing' | 'done' | 'failed';
export type IdeaScheduleStatus = 'planned' | 'in_progress' | 'completed';
export type IdeaScheduleCategory = 'general' | 'blog' | 'youtube';

export interface IdeaDoc {
  id: string;
  ownerId: string;
  title: string;
  body: string;
  channel: IdeaChannel;
  status: IdeaDocStatus;
  notes: string | null;
  bodyImageUrls: string[];
  createdAt: string;
  updatedAt: string;
  publishJob?: IdeaJob | null;
}

export interface IdeaJob {
  id: string;
  ownerId: string;
  docId: string | null;
  title: string;
  bodyHtml: string;
  channel: IdeaChannel;
  status: IdeaJobStatus;
  scheduledAt: string | null;
  externalUrl: string | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IdeaScheduleItem {
  id: string;
  ownerId: string;
  title: string;
  scheduledDate: string;
  category: IdeaScheduleCategory;
  status: IdeaScheduleStatus;
  createdAt: string;
  updatedAt: string;
}

export type CalendarKind = 'plan' | 'publish';

export interface CalendarEntry {
  kind: CalendarKind;
  id: string;
  title: string;
  date: string;
  status: string;
  category?: IdeaScheduleCategory;
  externalUrl?: string | null;
  docId?: string | null;
  channel?: IdeaChannel;
}
