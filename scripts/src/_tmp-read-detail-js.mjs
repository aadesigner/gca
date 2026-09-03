const url = "https://www.seobuk.org/assets/custom/seobuk/basic/js/v3/search/detail.js?v=1775020320";
const t = await (await fetch(url)).text();
console.log("len", t.length);
for (const needle of ["car-img-div", "car-option-ul", "img_list", "images/user", "$.ajax", "$.post", "$.get", "photo", "image"]) {
  let i = 0;
  let n = 0;
  while ((i = t.indexOf(needle, i)) >= 0 && n < 8) {
    console.log(`\n==== ${needle} @${i} ====`);
    console.log(t.slice(Math.max(0, i - 100), i + 450));
    i += needle.length;
    n++;
  }
}
