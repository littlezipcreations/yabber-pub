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
const post = document.getElementById('postN');

loginBtn.onclick = async () => {
  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email: emailEl.value,
    password: passwordEl.value,
  });
  if (error) return alert(error.message);
  alert('Logged in!');

  const profile = await fetchMyProfile();
  if (profile) {
    document.querySelector('#headerUsername')?.remove(); // clean old
    const span = document.createElement('span');
    span.id = 'headerUsername';
    span.textContent = `👤 ${profile.username}`;
    document.querySelector('h1').appendChild(span);
  }

  loadPosts();
  auth.style.display = 'none';
  post.style.display = 'block';
};

signupBtn.onclick = async () => {
  const email    = emailEl.value.trim();
  const password = passwordEl.value;
  const username = document.getElementById('username').value.trim();

  if (!username.match(/^[a-z0-9_]{3,30}$/i)) {
    return alert('Usernames may contain letters, numbers, underscores (3‑30 chars).');
  }

  // 1️⃣ Create the auth user
  const { data: signUpData, error: signUpErr } = await supabaseClient.auth.signUp({
    email,
    password,
  });
  if (signUpErr) return alert('Sign‑up error: ' + signUpErr.message);

  // 2️⃣ Insert profile (username must be unique)
  const userId = signUpData.user.id;
  const { error: profileErr } = await supabaseClient
      .from('profiles')
      .insert({ id: userId, username })
      .single(); // we only insert one row

  if (profileErr) {
    // clean up auth user if profile fails
    await supabaseClient.auth.admin.deleteUser(userId).catch(() => {});
    return alert('Username error: ' + profileErr.message);
  }

  alert('Account created! You are now logged in.');
  await checkUser();            // will hide login, show post interface
  loadPosts();                  // refresh feed with real usernames
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
async function fetchMyProfile() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return null;
  const { data: profile, error } = await supabaseClient
    .from('profiles')
    .select('username, avatar_url, bio')
    .eq('id', user.id)
    .single();
  return error ? null : profile;
}

/**
 * Load the feed, showing each post with the author's @username.
 * Uses a single join to the `profiles` table – no admin calls, no N+1 loops.
 */
async function loadPosts() {
  // 1️⃣ Pull posts + the related profile username in ONE request.
  const { data: posts, error } = await supabaseClient
    .from('posts')
    // The `profiles!inner(username)` syntax tells PostgREST:
    //   join the `profiles` table (via posts.user_id → profiles.id)
    //   and return only the `username` column from that row.
    .select(`
      id,
      content,
      created_at,
      user_id,
      profiles!inner(username)
    `)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('❗ loadPosts error:', error);
    return;
  }

  // Nothing to show?
  if (!posts?.length) {
    feedEl.innerHTML = '<p>🗒️ No posts yet – be the first!</p>';
    return;
  }

  // 2️⃣ Build the HTML.  If, for some reason, a profile row is missing,
  // fall back to the old `username` (which you stored at post‑creation)
  // or to “anon”.
  const html = posts
    .map(p => {
      const displayName =
        p.profiles?.username?.split('@')[0] ?? // clean the handle if they typed an e‑mail
        p.username?.split('@')[0] ??        // fallback to the old field you stored
        'anon';

      return `
        <div class="post" data-post-id="${p.id}">
          <b>${displayName}</b> @ <i>${new Date(p.created_at).toLocaleString()}</i><br>
          ${p.content}
        </div>`;
    })
    .join('');

  feedEl.innerHTML = html;
}

checkLocalStorage();
loadPosts();
window.setInterval(loadPosts(), 10000);