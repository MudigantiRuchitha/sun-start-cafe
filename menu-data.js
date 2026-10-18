const menuData = [
  { id: 1, name: "Hot Coffee", category: "Drinks", price: 40, desc: "Freshly brewed and comforting.", image: "https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=700&q=80" },
  { id: 2, name: "Veg Burger", category: "Snacks", price: 80, desc: "A tasty burger with a veggie patty.", image: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=700&q=80" },
  { id: 3, name: "Veg Sandwich", category: "Snacks", price: 70, desc: "Fresh vegetables in toasted bread.", image: "https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&w=700&q=80" },
  { id: 4, name: "Veg Pizza", category: "Snacks", price: 130, desc: "Cheesy pizza topped with vegetables.", image: "https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=700&q=80" },
  { id: 5, name: "Tea", category: "Drinks", price: 20, desc: "Classic Indian-style tea.", image: "https://images.unsplash.com/photo-1544787219-7f47ccb76574?auto=format&fit=crop&w=700&q=80" },
  { id: 6, name: "Egg Puff", category: "Puffs", price: 25, desc: "Flaky puff pastry with egg filling.", image: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/ca/Egg_Puff1.jpg/500px-Egg_Puff1.jpg", imageCredit: "Photo: Affaf Ali (CC BY-SA 4.0)", imageCreditUrl: "https://commons.wikimedia.org/wiki/File:Egg_Puff1.jpg" },
  { id: 7, name: "Veg Puff", category: "Puffs", price: 25, desc: "Golden pastry with a savoury veg filling.", image: "https://thumb.wikimedia.org/wikipedia/commons/thumb/6/6c/Pastelitos_de_hojaldre_con_puerro_y_tofu_-_Vegan_leek_and_tofu_puff_pastry_%285592619766%29.jpg/500px-Pastelitos_de_hojaldre_con_puerro_y_tofu_-_Vegan_leek_and_tofu_puff_pastry_%285592619766%29.jpg", imageCredit: "Photo: Lablascovegmenu (CC BY 2.0)", imageCreditUrl: "https://commons.wikimedia.org/wiki/File:Pastelitos_de_hojaldre_con_puerro_y_tofu_-_Vegan_leek_and_tofu_puff_pastry_(5592619766).jpg" },
  { id: 8, name: "Chicken Puff", category: "Puffs", price: 35, desc: "Crispy pastry with chicken filling.", image: "https://images.pexels.com/photos/37800262/pexels-photo-37800262/free-photo-of-close-up-of-a-delicious-savory-pastry-on-black-surface.jpeg?auto=compress&cs=tinysrgb&w=700", imageCredit: "Photo: Pexels", imageCreditUrl: "https://www.pexels.com/photo/close-up-of-a-delicious-savory-pastry-on-black-surface-37800262/" },
  { id: 9, name: "Chicken Fried Rice", category: "Meals", price: 120, desc: "Savoury fried rice with chicken.", image: "https://images.unsplash.com/photo-1603133872878-684f208fb84b?auto=format&fit=crop&w=700&q=80" },
  { id: 10, name: "Egg Fried Rice", category: "Meals", price: 90, desc: "Wok-tossed rice with egg and vegetables.", image: "https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=700&q=80" },
  { id: 11, name: "Veg Fried Rice", category: "Meals", price: 80, desc: "Fried rice with colourful vegetables.", image: "https://images.unsplash.com/photo-1603133872878-684f208fb84b?auto=format&fit=crop&w=700&q=80" }
];

if (typeof module === "object" && module.exports) {
  module.exports = menuData;
} else {
  globalThis.SUN_STAR_MENU = menuData;
}
