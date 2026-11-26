// lib/seo/seed-invalid-ranges.ts — DataForSEO Google Ads 키워드 금지 문자 코드 범위(데이터 전용, 손으로 고치지 말 것).
// 출처: https://dataforseo.com/help-center/using-symbols-in-keywords-when-setting-a-google-ads-task 의 Regex 원문
// (2026-11-27 받음, 399개 범위, 원문 sha256 앞 16자 8d4d3ac831ad3f86)을 프로그램으로 변환 + 4바이트 문자(서로게이트 D800–DFFF).
// 형식: 16진 코드포인트 "a" 또는 "a-b"를 쉼표로 나열. 한글 음절·자모·숫자·영문은 포함되지 않는다(테스트로 고정).
export const INVALID_RANGES_HEX =
  "0-1f,21,25,28-2a,2c,3b-40,5c,5e,60,7b-9f,a1-a2,a4-a9,ab-b4,b6,b8-b9,bb-bf,d7,f7,250-258,25a-2af,2c2-2c5,2d2-2d" +
  "f,2e5-2eb,2ed,2ef-2ff,375,37e,384-385,387,3f6,482,488-489,55a-560,588-58f,5be,5c0,5c3,5c6,5ef,5f3-60f,61b-61f," +
  "66a-66d,6d4,6dd-6de,6e9,6fd-6fe,700-70f,7f6-7f9,7fd-7ff,830-83e,85e,870-89f,8b5,8be-8d3,8e2,964-965,970,9f2-9f" +
  "b,9fd-9fe,a76,af0-af1,b55,b70,b72-b77,bf0-bfa,c04,c3c,c5d,c77-c7f,c84,cdd,d04,d4f,d58-d5e,d70-d79,d81,df4,e3f," +
  "e4f,e5a-e5b,e86,e89,e8c,e8e-e93,e98,ea0,ea8-ea9,eac,eba,f01-f17,f1a-f1f,f2a-f34,f36,f38,f3a-f3d,f85,fbe-fc5,fc" +
  "7-fda,104a-104f,109e-109f,10fb,1360-137c,1390-1399,1400,166d-166e,169b-169c,16eb-16ed,170d,1715-171f,1735-1736" +
  ",17d4-17d6,17d8-17db,17f0-180a,180e-180f,1878,1940-1945,19da-19ff,1a1e-1a1f,1aa0-1aa6,1aa8-1aad,1abe-1ace,1b4c" +
  ",1b5a-1b6a,1b74-1b7e,1bfc-1bff,1c3b-1c3f,1c7e-1c7f,1c90-1cc7,1cd3,1cfa,1dfa,1fbd,1fbf-1fc1,1fcd-1fcf,1fdd-1fdf" +
  ",1fed-1fef,1ffd-1ffe,200b-2027,202a-202e,2030-203e,2041-2053,2055-205e,2060-2070,2074-207e,2080-208e,20a0-20ab" +
  ",20ad-20c0,20dd-20e0,20e2-20e4,2100-2101,2103-2106,2108-2109,2114,2116-2118,211e-2123,2125,2127,2129,212e,213a" +
  "-213b,2140-2144,214a-214d,214f-2169,2170-2179,2189-2bff,2c2f,2c5f,2ce5-2cea,2cf9-2cff,2d70,2e00-2e2e,2e30-2ffb" +
  ",3001-3004,3006-3020,3030,3036-3037,303d-303f,309b-309c,30a0,30fd-30fe,312f,3190-319f,31bb-31e3,3200-33ff,4dbf" +
  "-4dff,4e28,4edd,4f00,4f03,4f39,4f56,4f92,4f94,4f9a,4fc9,4fff,5040,5042,5046,5094,50d8,50f4,514a,5164,519d,51be" +
  ",51ec,529c,52af,5307,5324,53dd,548a,54ff,5759,5765,57ac,57c7-57c8,58b2,590b,595b,595d,5963,5ca6,5cf5,5d42,5d53" +
  ",5dd0,5f21,5f34,5f45,608a,60de,6111,6130,6198,6213,62a6,63f5,6460,649d,661e,6624,662e,6659,6699,66a0,66b2,66bf" +
  ",66fa-66fb,670e,6766,6801,6852,68c8,68cf,6998,6a30,6a46,6a73,6a7e,6ae2,6ae4,6c6f,6c86,6d96,6dcf,6df2,6ebf,6fb5" +
  ",7007,7104,710f,7146,72b1,72be,7324,73bd,73f5,7429,769c,7821,7864,7994,799b,7ae7,7b9e,7d48,7e8a,8362,837f,83f6" +
  ",84dc,856b,8807,88f5,891c,8a37,8aa7,8abe,8adf,8b53,8b7f,8cf0,8d12,9067,91da,91de,91e4,91ee,9206,923c,924e,9259" +
  ",9288,92a7,92d3,92d5,92d7,92e0,92e7,92ff,9302,931d,9325,93a4,93c6,93f8,9431,9445,969d,96af,9733,9743,974d,974f" +
  ",9755,9857,9927,9adc,9b72,9b75,9b8f,9bb1,9bbb,9c00,9e19,9feb-9fff,a490-a4c6,a4fe-a4ff,a60d-a60f,a670-a673,a67e" +
  ",a6f2-a716,a720-a721,a789-a78a,a7af,a7b8-a7f6,a828-a839,a874-a877,a8ce-a8cf,a8f8-a8fa,a8fc,a8fe-a8ff,a92e-a92f" +
  ",a95f,a9c1-a9cd,a9de-a9df,aa5c-aa5f,aa77-aa79,aade-aadf,aaf0-aaf1,ab5b,ab66-ab6b,abeb,d800-f8ff,fa0e-fa0f,fa11" +
  ",fa13-fa15,fa1f-fa21,fa23-fa24,fa27-fa29,fb00-fb06,fb29,fbb2-fbc2,fd3e-fd4f,fdcf,fdfc-fdff,fe10-fe19,fe30-fe32" +
  ",fe35-fe4c,fe50-fe6b,feff-ff05,ff07-ff0a,ff0c-ff0f,ff1a-ff20,ff3b-ff3e,ff40,ff5b-ffff";
