// Starter document for a new diagram, localized so the notes read naturally in either language.
export function sampleDbml(lang: 'en' | 'zh'): string {
  const n = lang === 'zh'
    ? { users: '用户表', email: '登录邮箱', posts: '用户发布的文章', body: '正文内容', status: '文章状态', follows: '关注关系', sticky: '在左侧编辑 DBML，右侧实时生成关系图。拖动表格可调整布局。' }
    : { users: 'Registered users', email: 'Login email', posts: 'Posts written by users', body: 'Content of the post', status: 'Publication status', follows: 'Who follows whom', sticky: 'Edit DBML on the left; the diagram updates live. Drag tables to arrange them.' };
  return `// DBML docs: https://dbml.dbdiagram.io/docs

Table users [note: '${n.users}'] {
  id integer [pk, increment]
  username varchar(50) [not null, unique]
  email varchar(255) [not null, note: '${n.email}']
  role varchar [default: 'member']
  created_at timestamp [default: \`now()\`]
}

Table posts [headercolor: #3498DB, note: '${n.posts}'] {
  id integer [pk, increment]
  title varchar [not null]
  body text [note: '${n.body}']
  user_id integer [not null]
  status post_status
  created_at timestamp

  Indexes {
    (user_id, created_at)
  }
}

Table follows [note: '${n.follows}'] {
  following_user_id integer [pk]
  followed_user_id integer [pk]
  created_at timestamp
}

Enum post_status {
  draft
  published
  archived [note: '${n.status}']
}

Ref: posts.user_id > users.id
Ref: follows.following_user_id > users.id
Ref: follows.followed_user_id > users.id

Note tips {
  '${n.sticky}'
}
`;
}
