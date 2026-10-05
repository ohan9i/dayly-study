import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

test('the array migration is repeatable and keeps legacy records and permissions', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role authenticated;
      create table public.tasks (
        id text primary key, title text not null, date date not null,
        subject text not null default '', time text not null default '',
        details text not null default ''
      );
      create table public.task_completions (task_id text references public.tasks(id));
      grant select, insert on public.tasks to authenticated;
      grant update(title, date, details) on public.tasks to authenticated;
      insert into public.tasks values ('old', '수학 공부', '2026-10-05', '수학', '09:00', '문제집 30페이지까지');
      insert into public.task_completions values ('old');
    `);
    const migration = readFileSync(
      new URL('../supabase/migrations/20261005_task_detail_items.sql', import.meta.url),
      'utf8',
    );
    await db.exec(migration);
    await db.exec(migration);
    expect((await db.query('select * from public.tasks')).rows).toEqual([
      {
        id: 'old',
        title: '수학 공부',
        date: new Date('2026-10-05T00:00:00Z'),
        subject: '수학',
        time: '09:00',
        details: '문제집 30페이지까지',
        detail_items: null,
      },
    ]);
    expect((await db.query('select * from public.task_completions')).rows).toEqual([
      { task_id: 'old' },
    ]);
    await db.exec('set role authenticated');
    await db.query('update public.tasks set detail_items=$1, details=$2 where id=$3', [
      ['순열', '확률', '오답'],
      '',
      'old',
    ]);
    expect(
      (await db.query<{ detail_items: string[] }>('select detail_items from public.tasks')).rows[0]
        .detail_items,
    ).toEqual(['순열', '확률', '오답']);
    await db.query(
      "insert into public.tasks (id,title,date,detail_items) values ('new','제목만','2026-10-05', '{}')",
    );
    await db.query("update public.tasks set detail_items='{}' where id='old'");
    expect(
      (
        await db.query<{ detail_items: string[] }>(
          "select detail_items from public.tasks where id='old'",
        )
      ).rows[0].detail_items,
    ).toEqual([]);
    await expect(
      db.query("update public.tasks set detail_items=ARRAY['내용',null] where id='old'"),
    ).rejects.toThrow(/check constraint/);
    await expect(
      db.query("update public.tasks set subject='다른 과목' where id='old'"),
    ).rejects.toThrow(/permission denied/);
  } finally {
    await db.close();
  }
}, 30000);
