-- Tiltekt í vefumsjón: gömul drög sem hafa verið leyst af hólmi (tilvísanir halda sér)
DELETE FROM pages WHERE path IN ('um-hsk/heradsthing/eldri-thing', 'um-hsk/vidbragdsaaetlun') AND status = 'draft';
