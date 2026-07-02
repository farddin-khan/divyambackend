const express = require("express");
const app = express();

app.get("/api/products", (req, res) => {
  res.json({
    success: true,
    products: [
      {
        id: 1,
        name: "Ashwagandha Capsules",
        price: 499
      },
      {
        id: 2,
        name: "Shilajit Resin",
        price: 899
      }
    ]
  });
});

app.listen(4000, () => {
  console.log("Server running on port 4000");
});