console.log("JS LOADED");
let supabaseClient = window.supabase.createClient("https://nxkbnwczvdnvdxcmobav.supabase.co","sb_publishable_vwZMhTlVry3nmkczDd2YCA_ixPq3DfK");

const feedEl = document.getElementById("feed");
const postBtn = document.getElementById("postBtn");
const contentEl = document.getElementById("content");
const loginBtn = document.getElementById("loginBtn");
const signupBtn = document.getElementById("signupBtn");
const emailEl = document.getElementById("email");
const passwordEl = document.getElementById("password");
const auth = document.getElementById('auth');
const post = document.getElementById('post');

loginBtn.onclick = async() => {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
        email: emailEl.value,
        password: passwordEl.value
    });
    if (error) return alert(error.message);
    alert("Logged in!");
    loadPosts();
    auth.style.display = "none";
    post.style.display = "block";
};
signupBtn.onclick = async () => {
    const { data, error} = await supabaseClient.auth.signUp({
        email: emailEl.value,
        password: passwordEl.value
    });
    if (error) return alert(error.message);
    alert("Signed up!");
    loadPosts();

};
postBtn.onclick = async() => {
    const user = supabaseClient.auth.getUser();
    const { data: currentUser, error: userErr} = await user;
    if(!currentUser?.user) return alert("Log in...");
    const {error} = await supabaseClient.from("posts").insert([
        {
            content: contentEl.value,
            user_id: currentUser.user.id,
            username: emailEl.value
        }
    ]);
    if (error) return alert(error.message);
    contentEl.value = "";
    loadPosts();
};
async function checkUser(){
    const { data: {user}} = await supabaseClient.auth.getUser();
    if (user){
        auth.style.display = "block";
        post.style.display = "none";
    } else {
        auth.style.display = "block";
        post.style.display = "block";
    }
}
function checkLocalStorage(){
    const userData = JSON.parse(localStorage.getItem("user"));
    if (userData){
        auth.style.display = "none";
        post.style.display = "block";
    }else{
        auth.style.display = "block";
        post.style.display = "none";
    }
}
async function loadPosts() {
    const{ data, error} = await supabaseClient.from("posts").select("content, user_id, created_at, username").order("created_at", {ascending : false});
    if (error) return console.error(error);
    if (!data) return;

    for (let post of data){
        const { data: userData} = await supabaseClient.auth.admin.getUserById(post.user_id).catch(() => ({data : {user: { email: "anon"}}}));
        post.user_email = userData?.user?.email ?? "anon";
    }
    feedEl.innerHTML = data.map(p => `<div class="post">
        <b>${p.username}</b> @ <i>${new Date(p.created_at).toLocaleString()}</i><br>
        ${p.content}</div>`).join("");
}
checkLocalStorage();
loadPosts();
window.setInterval(loadPosts(), 10000);