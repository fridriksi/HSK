"""Build the HSK web tables from the public Excel editions.

Install xlrd==2.0.2 and openpyxl==3.1.5, then run from the repository root:
    python scripts/import-record-books.py [--source-dir PATH]

With --source-dir, the workbook files are read from that directory. Otherwise
the importer downloads the sources listed in scripts/record-book-sources.json.
"""

import argparse
import io
import json
import re
from datetime import date, datetime, time, timedelta
from pathlib import Path
from urllib.request import Request, urlopen

import xlrd
from openpyxl import load_workbook


ROOT = Path(__file__).resolve().parents[1]
BIRTH = {'fd', 'fædd', 'fæddur', 'fæðingard', 'fæðingardagur', 'fæðingarár'}
HEADINGS = BIRTH | {
    'grein', 'nafn', 'nöfn', 'nafn keppanda', 'árangur', 'tími', 'vindur', 'wma%',
    'aldur', 'flokkur', 'félag', 'staður', 'dags', 'dagsetning', 'met sett',
    'ath', 'athugasemd', 'athugasemdir', 'nr á afrekaskrá', 'ísmet', 'íslmet',
}
GROUP = re.compile(r'^(?:karlar|konur|piltar|stúlkur|drengir|stelpur|strákar|karlaflokkur|kvennaflokkur|piltaflokkur|stúlknaflokkur|bæði kyn|\d+\+,? bæði kyn)\b', re.I)
EXCEL_ERRORS = {0: '#NULL!', 7: '#DIV/0!', 15: '#VALUE!', 23: '#REF!', 29: '#NAME?', 36: '#NUM!', 42: '#N/A'}
FULL_DATE = re.compile(r'^\d{1,2}[./-]\d{1,2}[./-]((?:18|19|20)\d{2})$')
DATE_FIELDS = {'met sett', 'dags', 'dagsetning'}


def clean(value):
    return re.sub(r'[^\S\n]+', ' ', str(value).replace('\r\n', '\n').replace('\r', '\n')).strip()


def heading(value):
    return clean(value).lower().replace('.', '')


def clock(seconds, fmt):
    if fmt == 'mm:ss.0':
        minutes, tenths = divmod(round(seconds * 10), 600)
        return f'{minutes:02}:{tenths // 10:02},{tenths % 10}'
    hours, rest = divmod(round(seconds), 3600)
    minutes, seconds = divmod(rest, 60)
    if fmt != '[h]:mm:ss':
        hours %= 24
    return f'{hours}:{minutes:02}' + (f':{seconds:02}' if fmt.endswith('ss') else '')


def value_text(value, fmt, date_epoch=None, birth=False):
    if value is None or value == '':
        return ''
    if isinstance(value, bool):
        return 'Já' if value else 'Nei'
    if isinstance(value, (int, float)) and date_epoch is not None:
        if fmt in ('mm:ss.0', 'h:mm:ss', 'h:mm', '[h]:mm:ss'):
            return '' if birth else clock(value * 86400, fmt)
        value = xlrd.xldate_as_datetime(value, date_epoch)
    if birth:
        if isinstance(value, date):
            return str(value.year) if 1800 <= value.year <= 2099 else ''
        # Ártöl eru einnig skráð sem tölur, texti eða listi fyrir boðhlaup.
        return ' / '.join(re.findall(r'(?<!\d)(?:18|19|20)\d{2}(?!\d)', str(value)))
    if isinstance(value, date):
        return f'{value.day:02}.{value.month:02}.{value.year}'
    if isinstance(value, (time, timedelta)):
        seconds = value.total_seconds() if isinstance(value, timedelta) else value.hour * 3600 + value.minute * 60 + value.second + value.microsecond / 1e6
        return clock(seconds, fmt)
    if isinstance(value, (int, float)):
        if fmt in {'0.00%', '0%'}:
            return format(value, '.2%' if fmt == '0.00%' else '.0%').replace('.', ',')
        if fmt in {'0.0', '0.00'}:
            return format(value, f'.{len(fmt) - 2}f').replace('.', ',')
        if fmt == '#,##0':
            return format(value, ',.0f').replace(',', '.')
        return format(value, '.15g').replace('.', ',')
    return clean(value)


def raw_sheets(data, name):
    if name.lower().endswith('.xls'):
        workbook = xlrd.open_workbook(file_contents=data, formatting_info=True)
        for sheet in workbook.sheets():
            if sheet.visibility:
                continue
            rows = []
            for row_index in range(sheet.nrows):
                row = []
                for cell in sheet.row(row_index):
                    fmt = workbook.format_map[workbook.xf_list[cell.xf_index].format_key].format_str
                    value = cell.value
                    if cell.ctype == xlrd.XL_CELL_ERROR:
                        value = EXCEL_ERRORS.get(value, '#ERROR!')
                    elif cell.ctype == xlrd.XL_CELL_BOOLEAN:
                        value = bool(value)
                    row.append((value, fmt, workbook.datemode if cell.ctype == xlrd.XL_CELL_DATE else None))
                rows.append(row)
            yield sheet.name, rows
    else:
        workbook = load_workbook(io.BytesIO(data), data_only=True, read_only=True)
        try:
            for sheet in workbook:
                if sheet.sheet_state == 'visible':
                    yield sheet.title, [[(c.value, c.number_format, None) for c in row] for row in sheet.iter_rows()]
        finally:
            workbook.close()


def trimmed(values):
    last = max((i + 1 for i, value in enumerate(values) if value), default=0)
    return values[:last]


def header_row(row):
    fields = {heading(cell) for cell in row if cell}
    return len(fields & HEADINGS) >= 2 and bool(fields & {'nafn', 'nöfn', 'nafn keppanda', 'met sett', 'árangur', 'tími'})


def annual_headers(book_id):
    if book_id.startswith('fatladir-'):
        return ['Grein', 'Nafn', 'Fæðingarár', 'Flokkur', 'Árangur', 'Staður', 'Met sett', 'Athugasemdir']
    if book_id.startswith('oldungar-innanhuss-') or book_id == 'innanhuss-2013':
        performance = ['Árangur', 'Dálkur 3'] if book_id.startswith('oldungar-') else ['Nr. á afrekaskrá', 'Árangur']
        return ['Grein', *performance, 'Nafn', 'Fæðingarár', 'Staður', 'Met sett', 'Athugasemdir']
    return ['Grein', 'Árangur', 'Nafn', 'Fæðingarár', 'Staður', 'Met sett', 'Athugasemdir']


def sheet_tables(raw_rows, book_id):
    rows = [(raw, trimmed([value_text(*cell) for cell in raw])) for raw in raw_rows]
    rows = [(raw, values) for raw, values in rows if values]
    if not rows:
        return None
    trail_race = book_id == 'blaskogaskokk'
    annual = not trail_race and any('sett á árinu' in row[0].lower() for _, row in rows[:4])
    implicit_headers = annual_headers(book_id) if annual else []
    notes, sections = [], []
    current = None
    section_title = ''
    birth_cols = set()
    for index, (raw, values) in enumerate(rows):
        following = rows[index + 1][1] if index + 1 < len(rows) else []
        first = values[0]
        # Í frjálsum eru kyn/flokkur stundum í fyrsta hausreit; í sundi er greinin fyrir ofan hausinn.
        is_group = GROUP.match(first) and (len(values) == 1 or (annual and not any(values[1:-1]) and values[-1].isdigit()))
        if annual and is_group and implicit_headers:
            total = f' · {values[-1]} met' if len(values) > 1 else ''
            current = {'title': first + total, 'headers': implicit_headers, 'rows': []}
            sections.append(current)
            birth_cols = {implicit_headers.index('Fæðingarár')}
        elif len(values) == 1 and ((header_row(following) and not GROUP.match(following[0])) or (trail_race and 'mílu' in first.lower())) and not FULL_DATE.match(first):
            section_title = first
            current = None
        elif header_row(values):
            birth_cols = {i for i, cell in enumerate(values) if heading(cell) in BIRTH}
            headers = ['Fæðingarár' if i in birth_cols else cell for i, cell in enumerate(values)]
            if first and GROUP.match(first):
                section_title = first
                headers[0] = 'Grein'
            elif not first:
                headers[0] = 'Grein'
            if annual and headers[-1].isdigit():
                section_title = f'{section_title} · {headers[-1]} met'.strip(' ·')
                headers[-1] = 'Athugasemdir'
            current = {'title': section_title, 'headers': headers, 'rows': []}
            sections.append(current)
            section_title = ''
        elif trail_race and (section_title or current) and len(values) > 1:
            if current is None:
                current = {'title': section_title, 'headers': ['Flokkur', 'Tími', 'Nafn', 'Fæðingarár', 'Leið', 'Dagsetning'], 'rows': []}
                sections.append(current)
                section_title = ''
            values[3] = value_text(*raw[3], birth=True)
            current['rows'].append(trimmed(values))
        elif is_group and current is not None:
            current = {'title': first, 'headers': current['headers'], 'rows': []}
            sections.append(current)
        elif current is not None:
            for i in birth_cols.intersection(range(len(values))):
                values[i] = value_text(*raw[i], birth=True)
            for i, value in enumerate(values):
                if i in birth_cols:
                    continue
                header = current['headers'][i] if i < len(current['headers']) else ''
                # Eldri skrár hafa ómerkta aukadálka með dagsetningum, m.a. fæðingardögum.
                # Einungis dagsetningar í merktum metadálkum birtast með degi og mánuði.
                date = FULL_DATE.match(value)
                if date and heading(header) not in DATE_FIELDS:
                    values[i] = date.group(1)
            current['rows'].append(trimmed(values))
        else:
            for i in range(len(values)):
                if annual and i == implicit_headers.index('Fæðingarár'):
                    values[i] = value_text(*raw[i], birth=True)
            notes.append(values)

    # Stök blöð án dálkahausa eru varðveitt í töflu ef frumskráin raðar efninu í dálka.
    if not sections and any(len(row) > 1 for row in notes):
        sections.append({'title': '', 'headers': [], 'rows': notes})
        notes = []
    for section in sections:
        headers = section['headers']
        data = section['rows']
        width = max((len(row) for row in [headers, *data]), default=0)
        used = [i for i in range(width) if any(len(row) > i and row[i] for row in data)] if data else list(range(len(headers)))
        section['headers'] = [headers[i] if i < len(headers) and headers[i] else 'Athugasemdir' if i == len(headers) else f'Dálkur {i + 1}' for i in used]
        section['rows'] = [trimmed([row[i] if i < len(row) else '' for i in used]) for row in data]
    return {'notes': notes, 'sections': sections}


def build_book(source, source_dir):
    name = source['file'].rsplit('/', 1)[-1]
    if source_dir:
        data = (source_dir / name).read_bytes()
    else:
        request = Request(source['source'], headers={'User-Agent': 'Mozilla/5.0 (HSK metaskrár)'})
        with urlopen(request, timeout=30) as response:
            data = response.read()
    sheets = []
    for sheet_name, rows in raw_sheets(data, name):
        table = sheet_tables(rows, source['id'])
        if table:
            sheets.append({'name': clean(sheet_name), **table})
    if not sheets:
        raise ValueError(f'Engin gögn í {name}')
    return {**source, 'sheets': sheets}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', type=Path)
    args = parser.parse_args()
    sources = json.loads((ROOT / 'scripts/record-book-sources.json').read_text(encoding='utf-8'))
    if len({item['id'] for item in sources}) != len(sources) or len({item['file'] for item in sources}) != len(sources):
        raise ValueError('Skrár og auðkenni þurfa að vera einstök')
    books = [build_book(source, args.source_dir) for source in sources]
    output = ROOT / 'src/data/hsk-record-books.json'
    output.parent.mkdir(exist_ok=True)
    with output.open('w', encoding='utf-8', newline='\n') as file:
        file.write('[\n' + ',\n'.join(json.dumps(book, ensure_ascii=False, separators=(',', ':')) for book in books) + '\n]\n')
    print(f'{len(books)} metaskrár, {sum(len(book["sheets"]) for book in books)} vinnublöð')


if __name__ == '__main__':
    main()
