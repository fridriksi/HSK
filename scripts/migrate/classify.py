"""
Gamla vefkerfið var sameiginlegt með öðrum fyrirtækjum og fréttir þeirra eru í sömu númeraröð.
Fréttir HSK eru með númer frá 5001 og í tímaröð. Fréttir annarra koma í stökum hópum með mun eldri dagsetningum.
Frétt telst frá HSK ef dagsetning hennar er nálægt miðgildi dagsetninga næstu nágranna.
"""
import re
from datetime import date
from statistics import median

MIN_ID = 5001
WINDOW = 12        # nágrannar hvoru megin
MAX_DAYS = 150     # leyfilegt frávik frá miðgildi


def _d(s: str) -> int:
    y, m, d = map(int, s.split('-'))
    try:
        return date(y, m, d).toordinal()
    except ValueError:
        return date(y, m, 1).toordinal()


def hsk_ids(rows: list[tuple[int, str]], min_id: int = MIN_ID) -> set[int]:
    """rows: (númer, 'YYYY-MM-DD'). Skilar númerum sem tilheyra HSK."""
    rows = sorted(r for r in rows if r[0] >= min_id)
    days = [_d(r[1]) for r in rows]
    keep = set()
    for i, (fid, _) in enumerate(rows):
        nb = days[max(0, i - WINDOW):i] + days[i + 1:i + 1 + WINDOW]
        if not nb or abs(days[i] - median(nb)) <= MAX_DAYS:
            keep.add(fid)
    return keep


# Viðburðir annarra vefja eru á sama tímabili, svo þar þarf líka að skoða efnið
SPORT_WORDS = re.compile(
    r'\bHSK\b|Skarphéð|héraðs|ungmenna|\bumf\b|umf\.|UMFÍ|ÍSÍ|íþrótt|glím|frjáls|knattspyrn|körfu|handbolt|handknatt|blak|sund|skák|bridds|'
    r'badminton|borðtennis|júdó|judo|taekwondo|fimleik|hesta|skot|starfsíþr|golf|landsmót|mót\b|mótið|móti\b|meistar|keppn|þing\b|þingið|'
    r'aðalfund|formannafund|ráðstefn|námskeið|þjálf|lottó|afreks|sjálfboðal|styrk|félag|sambands|ráðs\b|nefnd|hlaup|ganga|göngu', re.I)
OTHER_WORDS = re.compile(r'Tony|breiðtjald|Eurovision|lokað hús|lokað vegna|lokað í kvöld|einkasamkv|diskótek|dansleik|stuðball|trúbador|karaoke|plugg|Center Earth|á barnum|happy hour|írsk(ir|a) dag|skífuþeyt|eldhúsið opið|júróví|Trek Öræfi|Hekluhestar|hestaferð|karlakvöld|Áfangagil|Hellatún|Rio Vista|gistiskál', re.I)
# Fyrir 2008 eru viðburðir annarra vefja (bar og hestaferðir) blandaðir saman við viðburði HSK án skýrra merkja
EVENTS_FROM = '2008-01-01'
JUNK = re.compile(r'^(prufa|test|sdsf|asdf|bara að prófa)', re.I)


def looks_like_hsk(title: str, body: str) -> bool:
    t = f'{title} {body}'
    return not OTHER_WORDS.search(t) and not JUNK.match(title.strip())
