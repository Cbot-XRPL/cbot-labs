console.log('page refresh')

//let local = "http://127.0.0.1:5500"
let local = "https://newterraconstruction.com"




//routing buttons ----------------------------------------------------------------------------------------------------

let logoButton = () => {
  location.assign(local)
  console.log('open active menu')
  }

let menuButton = () => {
const element = document.getElementById('0')
element.classList.contains("nav-moblie") ? element.classList.remove("nav-moblie") : element.classList.add("nav-moblie");
console.log('open active menu')
}


let homeButton = async () => {
  location.assign(`${local}`)
  console.log('go to services')
  }


let contactButton = async () => {
  location.assign(`${local}/contact.html`)
  console.log('go to services')
  }


let serviceButton = async () => {
location.assign(`${local}/index.html#1`)
const element = document.getElementById('0')
element.classList.contains("nav-moblie") ? element.classList.remove("nav-moblie") : console.log('not in moblie')
console.log('go to services')
}



let aboutButton = () => {
location.assign(`${local}/index.html#2`)
const element = document.getElementById('0')
element.classList.contains("nav-moblie") ? element.classList.remove("nav-moblie") : console.log('not in moblie')
console.log('go to about us')
}


let faqButton = () => {
location.assign(`${local}/index.html#3`)
console.log('go to FAQ')
}


let callButton = () => {
  window.open('tel:6782079719', '_self');
  console.log('set up call')
  }

  let emailButton = () => {
    window.open('mailto:sales@newterraconsturction.com', '_self');
    console.log('set up call')
  }

  let googleButton = () => {
    location.assign("https://g.co/kgs/EvZS4J")
    console.log('open active menu')
    }

    let angiButton = () => {
      location.assign("https://www.angi.com/companylist/us/ga/buford/new-terra-construction-reviews-11090456.htm?showcaseId=0")
      console.log('open active menu')
      }

      
    let nextdoorButton = () => {
      location.assign("https://nextdoor.com/pages/dixie-service-and-trade/")
      console.log('open active menu')
      }

  



    //form---------------------------------------------------------


// Initialize EmailJS
(function() {
  emailjs.init({
    publicKey: "WmQSqc_LUYI1MKFID", // from EmailJS Dashboard
  });
})();

// Attach event listener
document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("inquiryForm");

  form.addEventListener("submit", function(event) {
    event.preventDefault(); // stop normal form submission

    // Get form values
    const name = document.getElementById("name").value.trim();
    const email = document.getElementById("email").value.trim();
    const message = document.getElementById("message").value.trim();
    const phone = document.getElementById("phone").value.trim();

    // Create params object matching your EmailJS template variables
    const formData = {
      from_name: name,
      reply_to: email,
      message: message,
      phone: phone,
    };

    // Optional: show loading message
    const response = document.getElementById("responseMessage");
    response.textContent = "Sending...";

    // Send email using EmailJS
    emailjs.send("service_2dvtuee", "template_6b2zj3l", formData)
      .then(() => {
        response.textContent = `✅ Thank you, ${name}! Your message has been sent.`;
        form.reset();
      })
      .catch((error) => {
        console.error("EmailJS error:", error);
        response.textContent = "❌ Sorry, something went wrong. Please try again later.";
      });
  });
});





 /*

    document.getElementById('inquiryForm').addEventListener('submit', function(event) {
      event.preventDefault(); // Prevent form from submitting the traditional way
  
      // Get form values
      const name = document.getElementById('name').value;
      const email = document.getElementById('email').value;
      const message = document.getElementById('message').value;
  
      // Create an object to hold the form data
      const formData = {
          name: name,
          email: email,
          message: message
      };

      console.log(formData)
  
      // Display a message to the user
      document.getElementById('responseMessage').textContent = 'Thank you for your inquiry, ' + formData.name + '! We will get back to you shortly.';
  
      // Optionally, send the form data to a server using Fetch API
     
      fetch('https://your-server-endpoint.com/inquiry', {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json'
          },
          body: JSON.stringify(formData)
      })
      .then(response => response.json())
      .then(data => {
          console.log('Success:', data);
      })
      .catch((error) => {
          console.error('Error:', error);
      });
      
  }); */


