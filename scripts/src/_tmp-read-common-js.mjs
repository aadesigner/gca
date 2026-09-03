const t = await (await fetch("https://www.seobuk.org/assets/admin/js/common.js")).text();
console.log("len", t.length);
let idx = 0;
while ((idx = t.indexOf("$.ajax", idx)) >= 0) {
  console.log("==== ajax ====");
  console.log(t.slice(idx, idx + 700));
  idx += 5;
}
for (const needle of ["car-img-div", "car-option-ul", "images/user", "getCar", "photo", "img_list"]) {
  let i = 0;
  let n = 0;
  while ((i = t.indexOf(needle, i)) >= 0 && n < 5) {
    console.log(`\n==== ${needle} @${i} ====`);
    console.log(t.slice(Math.max(0, i - 120), i + 300));
    i += needle.length;
    n++;
  }
}
