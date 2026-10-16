"""Import/export the integration's own tag database, independent of ComfyUI."""
import json
import sqlite3
import sys
from pathlib import Path
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from export_weilin_tags import export

SCHEMA = '''
CREATE TABLE IF NOT EXISTS tag_groups(id_index INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT,color TEXT,create_time INTEGER,p_uuid TEXT(128));
CREATE TABLE IF NOT EXISTS tag_subgroups(id_index INTEGER PRIMARY KEY AUTOINCREMENT,group_id INTEGER,name TEXT,color TEXT,create_time INTEGER,p_uuid TEXT(128),g_uuid TEXT(128));
CREATE TABLE IF NOT EXISTS tag_tags(id_index INTEGER PRIMARY KEY AUTOINCREMENT,subgroup_id INTEGER,text TEXT,desc TEXT,color TEXT,create_time INTEGER,t_uuid TEXT(128),g_uuid TEXT(128));
CREATE UNIQUE INDEX IF NOT EXISTS idx_tag_groups_p_uuid ON tag_groups(p_uuid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tag_subgroups_g_uuid ON tag_subgroups(g_uuid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tag_tags_t_uuid ON tag_tags(t_uuid);
'''
TABLES = {'tag_groups', 'tag_subgroups', 'tag_tags'}

def hierarchy(connection):
    connection.row_factory = sqlite3.Row
    groups = [dict(row) for row in connection.execute('SELECT * FROM tag_groups ORDER BY create_time ASC, id_index ASC')]
    subgroups = [dict(row) for row in connection.execute('SELECT * FROM tag_subgroups ORDER BY create_time ASC, id_index ASC')]
    tags = [dict(row) for row in connection.execute('SELECT * FROM tag_tags ORDER BY create_time DESC, id_index ASC')]
    for group in groups:
        group['groups'] = [subgroup for subgroup in subgroups if subgroup['p_uuid'] == group['p_uuid']]
        for subgroup in group['groups']:
            subgroup['tags'] = [tag for tag in tags if tag['g_uuid'] == subgroup['g_uuid']]
    if sum(len(subgroup['tags']) for group in groups for subgroup in group['groups']) != len(tags):
        raise ValueError('SQL 中有未归组标签，请导出完整分类后重试')
    if sum(len(group['groups']) for group in groups) != len(subgroups):
        raise ValueError('SQL 中有未归类分组，请导出完整分类后重试')
    return {'version': 1, 'groups': groups, 'counts': {'categories': len(groups), 'groups': len(subgroups), 'tags': len(tags)}}

def decode_sql(contents):
    connection = sqlite3.connect(':memory:')
    connection.executescript(SCHEMA)
    # Weilin exports INSERT statements. Run those only in memory, with no file,
    # function, extension, schema or other-table access available to the input.
    allowed = {sqlite3.SQLITE_SELECT, sqlite3.SQLITE_TRANSACTION}
    def authorize(action, table, column, database, trigger):
        if action in allowed:
            return sqlite3.SQLITE_OK
        if action in {sqlite3.SQLITE_INSERT, sqlite3.SQLITE_READ} and table in TABLES | {'sqlite_sequence'}:
            return sqlite3.SQLITE_OK
        if action == sqlite3.SQLITE_UPDATE and table == 'sqlite_sequence':
            return sqlite3.SQLITE_OK
        return sqlite3.SQLITE_DENY
    connection.set_authorizer(authorize)
    budget = [0]
    def progress():
        budget[0] += 1
        return budget[0] > 30000
    connection.set_progress_handler(progress, 1000)
    connection.executescript(contents)
    connection.set_authorizer(None)
    result = hierarchy(connection)
    connection.close()
    return result

def write_database(database, library):
    target = Path(database)
    target.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(target, timeout=10)
    connection.executescript(SCHEMA)
    with connection:
        for table in ['tag_tags', 'tag_subgroups', 'tag_groups']:
            connection.execute('DELETE FROM ' + table)
        for category_index, group in enumerate(library['groups']):
            cursor = connection.execute('INSERT INTO tag_groups(name,color,create_time,p_uuid) VALUES(?,?,?,?)',
                                        (group['name'], group.get('color'), group.get('create_time', category_index), group['p_uuid']))
            category_id = cursor.lastrowid
            for group_index, subgroup in enumerate(group['groups']):
                cursor = connection.execute('INSERT INTO tag_subgroups(group_id,name,color,create_time,p_uuid,g_uuid) VALUES(?,?,?,?,?,?)',
                                            (category_id, subgroup['name'], subgroup.get('color'), subgroup.get('create_time', group_index), group['p_uuid'], subgroup['g_uuid']))
                subgroup_id = cursor.lastrowid
                for index, tag in enumerate(subgroup['tags']):
                    connection.execute('INSERT INTO tag_tags(subgroup_id,text,desc,color,create_time,t_uuid,g_uuid) VALUES(?,?,?,?,?,?,?)',
                                       (subgroup_id, tag['text'], tag['desc'], tag.get('color'), tag.get('create_time', len(subgroup['tags'])-index), tag['t_uuid'], subgroup['g_uuid']))
    connection.close()
    return export(target)

if __name__ == '__main__':
    sys.stdin.reconfigure(encoding='utf-8')
    sys.stdout.reconfigure(encoding='utf-8')
    request = json.load(sys.stdin)
    if sys.argv[1] == 'decode-sql':
        result = decode_sql(request['contents'])
    elif sys.argv[1] == 'write':
        result = write_database(sys.argv[2], request)
    else:
        raise ValueError('未知词库操作')
    print(json.dumps(result, ensure_ascii=True))
