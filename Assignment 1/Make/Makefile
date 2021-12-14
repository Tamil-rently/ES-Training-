.PHONY: all clean
all : linkedlist 
linkedlist : linkedlist.o ../linked_list_implementation.c
	gcc linkedlist.o -lm -o executable2
linked_list_implementation.o: ../linked_list_implementation.c
	gcc -c ../linked_list_implementation.c -o linkedlist.o
clean: 
	rm *.o linkedlist