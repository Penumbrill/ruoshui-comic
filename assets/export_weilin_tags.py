"""Read only the Weilin tag tables; never import history, credentials or settings.

The hierarchy and ordering follow Weilin's get_group_tags SQL (GPL-2.0).
Upstream: https://github.com/weilin9999/WeiLin-Comfyui-Tools
"""
import json
import sqlite3
import sys
from pathlib import Path

def export(database):
    source = Path(database).resolve(strict=True)
    connection = sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)
    connection.row_factory = sqlite3.Row
    connection.execute('BEGIN')
    groups = [dict(row) for row in connection.execute('SELECT * FROM tag_groups ORDER BY create_time ASC, id_index ASC')]
    subgroups = [dict(row) for row in connection.execute('SELECT * FROM tag_subgroups ORDER BY create_time ASC, id_index ASC')]
    tags = [dict(row) for row in connection.execute('SELECT * FROM tag_tags ORDER BY create_time DESC, id_index ASC')]
    connection.close()
    result = []
    for group in groups:
        children = []
        for subgroup in subgroups:
            if subgroup['p_uuid'] != group['p_uuid']:
                continue
            entries = [{key: tag.get(key) for key in ['id_index', 't_uuid', 'text', 'desc', 'color', 'create_time', 'g_uuid']}
                       for tag in tags if tag['g_uuid'] == subgroup['g_uuid']]
            children.append({**subgroup, 'tags': entries})
        result.append({**group, 'groups': children})
    count = sum(len(subgroup['tags']) for group in result for subgroup in group['groups'])
    if count != len(tags) or sum(len(group['groups']) for group in result) != len(subgroups):
        raise ValueError('Weilin 词库存在未归组记录，请在原插件中修复后再同步；本次未覆盖词库')
    stat = source.stat()
    return {'version': 1, 'source': {'kind': 'weilin', 'database': str(source), 'mtimeMs': stat.st_mtime_ns // 1000000,
                                   'bytes': stat.st_size}, 'groups': result,
            'counts': {'categories': len(groups), 'groups': len(subgroups), 'tags': count}}

if __name__ == '__main__':
    print(json.dumps(export(sys.argv[1]), ensure_ascii=True))
