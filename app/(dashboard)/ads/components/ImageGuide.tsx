// app/(dashboard)/ads/components/ImageGuide.tsx
// 이미지 확장소재 안내(3.6단계). MINTEQ는 이미지를 만들거나 올리지 않는다 — AI 생성 이미지는 글자·합성 금지 기준에 걸리기 쉽고
// '실제 서비스 이미지'로 인정받지 못할 수 있어서다. 규격은 네이버 공식 안내(2026-11-26 확인, 출처 링크).
const ITEMS: { title: string; lines: string[]; href: string }[] = [
  {
    title: '파워링크 이미지',
    lines: ['정사각형(1:1) · 최소 640×640 ~ 최대 2000×2000 · 5MB 이하 · JPG·PNG·BMP', '로고·글자·테두리·여백·전화번호·주소가 들어간 이미지는 안 됩니다', '광고그룹당 2개까지 · 같은 키워드의 다른 광고와 같은 이미지는 안 됩니다'],
    href: 'https://ads.naver.com/adguide/1209',
  },
  {
    title: '이미지형 서브링크',
    lines: ['정사각형(1:1) · 최소 640×640 · 서로 다른 이미지 3장', '링크 이름 6자 이내 · 광고 사이트 안의 페이지만'],
    href: 'https://ads.naver.com/adguide/1210',
  },
];

export function ImageGuide() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
      <b>이미지 확장소재는 네이버 광고 화면에서 직접 올려 주세요</b>
      <span style={{ fontSize: 12, color: 'var(--sub)' }}>네이버 광고 관리 → 해당 광고그룹 → 확장소재 → 추가. 실제 서비스 화면·사진을 쓰세요.</span>
      {ITEMS.map((x) => (
        <div key={x.title} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontWeight: 600 }}>{x.title} <a href={x.href} target="_blank" rel="noreferrer noopener" style={{ fontWeight: 400, fontSize: 12 }}>공식 기준</a></span>
          <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--sub)', fontSize: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {x.lines.map((l) => <li key={l}>{l}</li>)}
          </ul>
        </div>
      ))}
    </div>
  );
}
