export type Comment = {
  id: string;
  message: string;
  commentable_id: string;
  creator_id: string;
  created_at: Date;
  updated_at: Date;
};
