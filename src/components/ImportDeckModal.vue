<template>
  <div v-if="isOpen" class="modal-overlay">
    <div class="modal">
      <input type="file" @change="handleFileUpload" accept=".json" />
      <p v-if="error" class="error">{{ error }}</p>
      <div class="buttons">
        <button @click="importDeck">Import</button>
        <button @click="closeModal">Cancel</button>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  props: {
    isOpen: Boolean,
  },
  data() {
    return {
      file: null,
      error: "",
    };
  },
  methods: {
    handleFileUpload(event) {
      this.file = event.target.files[0];
      this.error = "";
    },
    async importDeck() {
      if (!this.file) {
        this.error = "No one file selected.";
        return;
      }

      if (!this.file.name.endsWith(".json")) {
        this.error = "The extension must be .json.";
        return;
      }

      try {
        const text = await this.file.text();
        const json = JSON.parse(text);

        
        if (
          !json.id || 
          !json.name || 
          !json.author || 
          !json.author_social || 
          !Array.isArray(json.cards) || 
          json.cards.length === 0 || 
          json.cards.some(card => !card.id || typeof card.ammount !== 'number' || card.ammount <= 0)
        ) {
          throw new Error("Invalid format.");
        }

        const validAmountValue = 60;

        const totalAmmount = json.cards.reduce((total, card) => total + card.ammount, 0);
        
        if (totalAmmount > validAmountValue) {
          throw new Error("The deck must have 60 cards or fewer.");
        }

        this.$emit("imported", json); // Send deck to App.vue
        this.closeModal();
      } catch (e) {
        this.error = "The file can't be processed: " + e.message;
      }
    },
    closeModal() {
      this.$emit("close");
    },
  },
};
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
}
.modal {
  background: white;
  padding: 20px;
  border-radius: 5px;
  text-align: center;
}
.error {
  color: red;
  margin-top: 10px;
}
.buttons {
  display: flex;
  justify-content: space-between;
  margin-top: 10px;
}
</style>
