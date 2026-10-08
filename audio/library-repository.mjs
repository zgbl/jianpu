import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';

// Storage contract: list(), get(id), put(record), remove(id), close().
// Records use the same camelCase fields regardless of the database driver.
export function createSqliteLibraryRepository(root){
 const directory=resolve(root,'.projects');mkdirSync(directory,{recursive:true});
 const db=new DatabaseSync(resolve(directory,'library.sqlite'));
 db.exec(`PRAGMA journal_mode=WAL;
  PRAGMA busy_timeout=5000;
  CREATE TABLE IF NOT EXISTS published_scores (
   project_id TEXT PRIMARY KEY, title TEXT NOT NULL, score_json TEXT NOT NULL,
   source_path TEXT, audio_offset REAL NOT NULL DEFAULT 0,
   project_revision INTEGER NOT NULL, published_at TEXT NOT NULL
  );`);
 if(!db.prepare('PRAGMA table_info(published_scores)').all().some(column=>column.name==='audio_offset')){
  db.exec('ALTER TABLE published_scores ADD COLUMN audio_offset REAL NOT NULL DEFAULT 0');
  const update=db.prepare('UPDATE published_scores SET audio_offset = ? WHERE project_id = ?');
  for(const row of db.prepare('SELECT project_id, score_json FROM published_scores').all()){
   const offset=JSON.parse(row.score_json)?.transcription?.clipStart;
   if(Number.isFinite(offset))update.run(offset,row.project_id);
  }
 }
 const list=db.prepare('SELECT * FROM published_scores ORDER BY published_at DESC');
 const get=db.prepare('SELECT * FROM published_scores WHERE project_id = ?');
 const put=db.prepare(`INSERT INTO published_scores(project_id,title,score_json,source_path,audio_offset,project_revision,published_at)
  VALUES(?,?,?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET title=excluded.title,
  score_json=excluded.score_json,source_path=excluded.source_path,
  audio_offset=excluded.audio_offset,project_revision=excluded.project_revision,published_at=excluded.published_at`);
 const remove=db.prepare('DELETE FROM published_scores WHERE project_id = ?');
 const decode=row=>row&&({id:row.project_id,title:row.title,score:row.score_json&&JSON.parse(row.score_json),sourcePath:row.source_path,audioOffset:row.audio_offset,revision:row.project_revision,publishedAt:row.published_at});
 return {
  async list(){return list.all().map(decode);},
  async get(id){return decode(get.get(id))||null;},
  async put(record){put.run(record.id,record.title,JSON.stringify(record.score),record.sourcePath,record.audioOffset??0,record.revision,record.publishedAt);return record;},
  async remove(id){remove.run(id);},
  close(){db.close();}
 };
}

export async function copyPublishedScores(source,target){
 let count=0;
 for(const {id} of await source.list()){
  const record=await source.get(id);
  if(record){await target.put(record);count++;}
 }
 return count;
}
