const home = await fetch("https://www.sellcarintl.com/buy-now", {
  headers: { "User-Agent": "Mozilla/5.0 Chrome/122" },
});
const cookies = home.headers.getSetCookie?.() ?? [];
const cookieHeader = cookies.map((c) => c.split(";")[0]).join("; ");
console.log("cookies", cookieHeader);

const bodies = [
  { curPage: 1, rowPerPage: 20, sortType: "01" },
  { currentPage: 1, rowPerPage: 20, orderBy: "01", orderType: "DESC" },
  { pageIndex: 1, pageSize: 20 },
];
for (const body of bodies) {
  const r = await fetch("https://www.sellcarintl.com/api/service/v1.0/getCarList.do", {
    method: "POST",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json;charset=UTF-8",
      "User-Agent": "Mozilla/5.0 Chrome/122",
      Origin: "https://www.sellcarintl.com",
      Referer: "https://www.sellcarintl.com/buy-now",
      Cookie: cookieHeader,
    },
    body: JSON.stringify(body),
  });
  console.log(JSON.stringify(body), r.status, (await r.text()).slice(0, 800));
}
